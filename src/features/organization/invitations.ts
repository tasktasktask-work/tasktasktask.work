import type pg from 'pg';
import { z } from 'zod';
import { hashPassword } from '#features/authentication/password.ts';
import { MIN_PASSWORD_LENGTH } from '#features/authentication/policy.ts';
import { clearLoginFailures, normalizeEmail } from '#features/authentication/queries.ts';
import { createSessionRecord, type IssuedSession } from '#features/authentication/session.ts';
import { expiresAt, hashToken, issueToken } from '#features/authentication/token.ts';
import {
  isUniqueViolation,
  type OrgScope,
  orgAdminExists,
  pool,
  transaction,
} from '#lib/db.ts';
import { many } from '#lib/row.ts';
import { sendInvitation } from './mail.ts';
import { type MemberRole, memberRole } from './queries.ts';

/* ==========================================================================
   招待

   組織にメンバーが増える唯一の経路である。
   メールドメインによる自動参加も、URLを知っていれば入れる仕組みも無い。

   トークンは受け取った人のメールボックスにしか届かない。
   つまり招待リンクを開けたこと自体が、そのアドレスの持ち主である証拠になる。
   マジックリンクと同じ性質なので、有効期間も48時間で揃えてある。
   ========================================================================== */

/** 招待した相手がまだ持っていない可能性があるので、users とは独立に検証する。 */
const emailShape = z
  .string()
  .trim()
  .min(1)
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);

/* --------------------------------------------------------------------------
   発行と取り消し
   -------------------------------------------------------------------------- */

export type InviteResult =
  | { ok: true }
  | { ok: false; reason: 'forbidden' | 'invalid-email' | 'already-member' | 'already-invited' };

/**
 * 招待を送る。
 *
 * 送れるのは組織管理者だけである。
 * その確認は SQL の中で行う。スコープに載っている役割を信じない。
 */
export async function inviteMember(
  scope: OrgScope,
  rawEmail: string,
  role: MemberRole,
): Promise<InviteResult> {
  const parsedEmail = emailShape.safeParse(rawEmail);
  if (!parsedEmail.success) {
    return { ok: false, reason: 'invalid-email' };
  }
  const email = normalizeEmail(parsedEmail.data);

  const { token, hash } = issueToken();

  const outcome = await transaction<InviteResult>(async (client) => {
    const { rows } = await client.query<{ allowed: boolean; member: boolean; name: string }>(
      `SELECT ${orgAdminExists('$1', '$2')} AS allowed,
              EXISTS (
                SELECT 1
                  FROM organization_members m
                  JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
                 WHERE m.organization_id = $1
                   AND m.deleted_at IS NULL
                   AND u.email = $3) AS member,
              (SELECT name FROM organizations WHERE id = $1) AS name`,
      [scope.organizationId, scope.userId, email],
    );

    const state = rows[0];
    if (!state?.allowed) {
      return { ok: false, reason: 'forbidden' };
    }
    if (state.member) {
      return { ok: false, reason: 'already-member' };
    }

    try {
      await client.query(
        `INSERT INTO invitations
           (organization_id, email, role, invited_by_user_id, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [scope.organizationId, email, role, scope.userId, hash, expiresAt()],
      );
    } catch (err) {
      // 未処理の招待は相手ごとに一件までという部分一意索引に当たった。
      // 二人の管理者が同時に送ったときにここへ来る。
      if (isUniqueViolation(err)) {
        return { ok: false, reason: 'already-invited' };
      }
      throw err;
    }

    return { ok: true };
  });

  if (!outcome.ok) {
    return outcome;
  }

  /*
   * メールはトランザクションの外で送る。
   * 中で送ると、後の失敗で行が消えたあとも、届いたリンクだけが残る。
   */
  const { rows } = await pool.query<{ org: string; inviter: string }>(
    `SELECT o.name AS org, u.display_name AS inviter
       FROM organizations o, users u
      WHERE o.id = $1 AND u.id = $2`,
    [scope.organizationId, scope.userId],
  );
  const context = rows[0];
  await sendInvitation(email, token, {
    organizationName: context?.org ?? '',
    inviterName: context?.inviter ?? '',
  });

  return { ok: true };
}

const pendingInvitation = z.object({
  id: z.uuid(),
  email: z.string(),
  role: memberRole,
  invitedByName: z.string(),
  expiresAt: z.date(),
  expired: z.boolean(),
  createdAt: z.date(),
});

export type PendingInvitation = z.infer<typeof pendingInvitation>;

/**
 * 未処理の招待。
 *
 * 中身はメールアドレスの一覧である。管理者以外には一件も返さない。
 * 絞り込みは SQL の中で行う。
 */
export async function listPendingInvitations(scope: OrgScope): Promise<PendingInvitation[]> {
  const result = await pool.query(
    `SELECT i.id,
            i.email,
            i.role,
            u.display_name        AS "invitedByName",
            i.expires_at          AS "expiresAt",
            (i.expires_at <= now()) AS expired,
            i.created_at          AS "createdAt"
       FROM invitations i
       JOIN users u ON u.id = i.invited_by_user_id
      WHERE i.organization_id = $1
        AND i.accepted_at IS NULL
        AND i.revoked_at IS NULL
        AND ${orgAdminExists('$1', '$2')}
      ORDER BY i.created_at DESC`,
    [scope.organizationId, scope.userId],
  );
  return many(pendingInvitation, result, 'listPendingInvitations');
}

export type RevokeResult = { ok: true } | { ok: false; reason: 'forbidden' | 'not-found' };

/** 招待を取り消す。取り消した時点でリンクは使えなくなる。 */
export async function revokeInvitation(
  scope: OrgScope,
  invitationId: string,
): Promise<RevokeResult> {
  const { rowCount } = await pool.query(
    `UPDATE invitations i
        SET revoked_at = now()
      WHERE i.id = $3
        AND i.organization_id = $1
        AND i.accepted_at IS NULL
        AND i.revoked_at IS NULL
        AND ${orgAdminExists('$1', '$2')}`,
    [scope.organizationId, scope.userId, invitationId],
  );
  return rowCount === 1 ? { ok: true } : { ok: false, reason: 'not-found' };
}

/* --------------------------------------------------------------------------
   受け取る側
   -------------------------------------------------------------------------- */

/** 使えない招待の理由。画面はこれを文言に変える。 */
export type InvitationProblem = 'invalid' | 'expired' | 'revoked' | 'used';

const preview = z.object({
  organizationName: z.string(),
  organizationSlug: z.string(),
  email: z.string(),
  role: memberRole,
  invitedByName: z.string(),
  /** そのメールアドレスのアカウントがまだ無い。あるならパスワードは訊かない。 */
  needsAccount: z.boolean(),
  expiresAt: z.date(),
});

export type InvitationPreview = z.infer<typeof preview>;

export type PreviewResult =
  | { ok: true; preview: InvitationPreview }
  | { ok: false; reason: InvitationProblem };

/**
 * 招待の中身を見る。参加を確かめる画面のためだけに使う。
 *
 * ここでは何も変えない。開いただけで参加になると、
 * メールソフトのリンク先読みで勝手に受諾される。
 */
export async function previewInvitation(token: string): Promise<PreviewResult> {
  const result = await pool.query(
    `SELECT o.name AS "organizationName",
            o.slug AS "organizationSlug",
            i.email,
            i.role,
            u.display_name AS "invitedByName",
            NOT EXISTS (
              SELECT 1 FROM users t
               WHERE t.email = i.email AND t.deleted_at IS NULL) AS "needsAccount",
            i.expires_at AS "expiresAt",
            (i.revoked_at IS NOT NULL)  AS revoked,
            (i.accepted_at IS NOT NULL) AS used,
            (i.expires_at <= now())     AS expired
       FROM invitations i
       JOIN organizations o ON o.id = i.organization_id AND o.deleted_at IS NULL
       JOIN users u ON u.id = i.invited_by_user_id
      WHERE i.token_hash = $1`,
    [hashToken(token)],
  );

  const raw = result.rows[0];
  if (!raw) {
    return { ok: false, reason: 'invalid' };
  }
  const problem = problemOf(raw);
  if (problem) {
    return { ok: false, reason: problem };
  }
  return { ok: true, preview: preview.parse(raw) };
}

export type AcceptResult =
  | { ok: true; userId: string; slug: string; session: IssuedSession; createdAccount: boolean }
  | { ok: false; reason: InvitationProblem | 'password-too-short' | 'display-name-required' };

export type AcceptInput = {
  readonly displayName?: string | undefined;
  readonly password?: string | undefined;
};

/**
 * 招待を受ける。
 *
 * アカウントの作成、所属の作成、招待の消し込み、セッションの記録を
 * ひとつのトランザクションで行う。
 * 途中で失敗して「所属はできたが招待は未処理のまま」を作らない。
 *
 * すでにそのアドレスのアカウントがある場合、パスワードには触らない。
 * 招待リンクを踏ませるだけで他人のパスワードを書き換えられては困る。
 *
 * Cookie はここでは扱わない。呼ぶ側が setSessionCookie を呼ぶ。
 */
export async function acceptInvitation(
  token: string,
  input: AcceptInput = {},
  meta: { userAgent?: string | undefined; ip?: string | undefined } = {},
): Promise<AcceptResult> {
  /*
   * ハッシュ化は重い処理なので、トランザクションの外で済ませる。
   * 中でやると接続を握ったまま数百ミリ秒待つことになる。
   */
  const displayName = input.displayName?.trim() ?? '';
  const password = input.password ?? '';

  const held = await previewInvitation(token);
  if (!held.ok) {
    return { ok: false, reason: held.reason };
  }
  if (held.preview.needsAccount) {
    if (displayName === '') {
      return { ok: false, reason: 'display-name-required' };
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      return { ok: false, reason: 'password-too-short' };
    }
  }
  const passwordHash = held.preview.needsAccount ? await hashPassword(password) : null;

  return transaction<AcceptResult>(async (client) => {
    const { rows } = await client.query<{
      id: string;
      organization_id: string;
      slug: string;
      email: string;
      role: MemberRole;
      revoked: boolean;
      used: boolean;
      expired: boolean;
    }>(
      `SELECT i.id,
              i.organization_id,
              o.slug,
              i.email,
              i.role,
              (i.revoked_at IS NOT NULL)  AS revoked,
              (i.accepted_at IS NOT NULL) AS used,
              (i.expires_at <= now())     AS expired
         FROM invitations i
         JOIN organizations o ON o.id = i.organization_id AND o.deleted_at IS NULL
        WHERE i.token_hash = $1
          FOR UPDATE OF i`,
      [hashToken(token)],
    );

    const invitation = rows[0];
    if (!invitation) {
      return { ok: false, reason: 'invalid' };
    }
    const problem = problemOf(invitation);
    if (problem) {
      return { ok: false, reason: problem };
    }

    const account = await findOrCreateUser(client, invitation.email, displayName, passwordHash);

    /*
     * 生きている所属があれば役割だけを合わせ、無ければ足す。
     *
     * 畳んである行を起こす形にはしない。
     * 入って抜けてを繰り返した人には畳んだ行が何本も並んでいて、
     * まとめて起こすと生きた行が二本になる。
     * 過去の所属は記録として残し、新しい所属は新しい行にする。
     */
    const revived = await client.query(
      `UPDATE organization_members
          SET role = $3
        WHERE organization_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [invitation.organization_id, account.id, invitation.role],
    );
    if (revived.rowCount === 0) {
      await client.query(
        `INSERT INTO organization_members (organization_id, user_id, role)
         VALUES ($1, $2, $3)`,
        [invitation.organization_id, account.id, invitation.role],
      );
    }

    await client.query(
      `UPDATE invitations
          SET accepted_at = now(), accepted_user_id = $2
        WHERE id = $1`,
      [invitation.id, account.id],
    );

    // 招待も、届いたことがそのアドレスの持ち主である証拠になる。
    // マジックリンクと同じように、ここでロックを解く。
    await clearLoginFailures(account.id, client);
    const session = await createSessionRecord(account.id, meta, client);

    return {
      ok: true,
      userId: account.id,
      slug: invitation.slug,
      session,
      createdAccount: account.created,
    };
  });
}

/* --------------------------------------------------------------------------
   中で使うもの
   -------------------------------------------------------------------------- */

function problemOf(row: {
  revoked: boolean;
  used: boolean;
  expired: boolean;
}): InvitationProblem | null {
  if (row.revoked) {
    return 'revoked';
  }
  if (row.used) {
    return 'used';
  }
  if (row.expired) {
    return 'expired';
  }
  return null;
}

/**
 * 招待されたアドレスのアカウントを用意する。
 *
 * 論理削除されたアカウントは無いものとして扱い、新しく作る。
 * 一意索引が deleted_at IS NULL に限ってあるので、同じアドレスで作れる。
 * 消したはずの人の記録が、招待をきっかけに蘇るほうが困る。
 */
async function findOrCreateUser(
  client: pg.PoolClient,
  email: string,
  displayName: string,
  passwordHash: string | null,
): Promise<{ id: string; created: boolean }> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL FOR UPDATE`,
    [email],
  );
  const found = existing.rows[0];
  if (found) {
    return { id: found.id, created: false };
  }

  /*
   * 表示名が空になるのは、確認の画面を見た時点ではアカウントが在り、
   * 送信するまでのあいだに消されたときだけである。
   * ここで落とすより、@ の左を仮の名前にして通したほうが実害がない。
   */
  const name = displayName === '' ? (email.split('@')[0] ?? email) : displayName;

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO users (email, display_name, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [email, name, passwordHash],
  );
  const row = inserted.rows[0];
  if (!row) {
    throw new Error(`アカウントを作れませんでした: ${email}`);
  }
  return { id: row.id, created: true };
}
