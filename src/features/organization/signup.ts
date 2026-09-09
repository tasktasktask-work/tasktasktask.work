import type pg from 'pg';
import { z } from 'zod';
import { hashPassword } from '#features/authentication/password.ts';
import { MIN_PASSWORD_LENGTH } from '#features/authentication/policy.ts';
import { clearLoginFailures, normalizeEmail } from '#features/authentication/queries.ts';
import { createSessionRecord, type IssuedSession } from '#features/authentication/session.ts';
import { expiresAt, hashToken, issueToken } from '#features/authentication/token.ts';
import { pool, transaction } from '#lib/db.ts';
import { sendSignupLink } from './mail.ts';
import { type CreateOrganizationResult, createOrganizationWithin } from './queries.ts';

/* ==========================================================================
   組織登録

   招待が「すでにある組織へ入る」ものであるのに対して、
   登録は「入る先を新しく作る」ものである。

   アドレスの確認が先、組織が後。
   organizations の行はリンクを踏んだ先でしか生まれないので、
   「まだ確認されていない組織」を掃除する仕組みが要らない。

   仕様は docs/features/organization/index.html#make にある。
   ========================================================================== */

/** 招待した相手と同じく、users にあるとは限らないアドレスを検証する。 */
const emailShape = z
  .string()
  .trim()
  .min(1)
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/);

/**
 * 同じアドレスへ送り直せる間隔。
 *
 * この経路は、任意のアドレスへメールを送らせられる唯一の入口である。
 * 招待は組織管理者しか送れず、マジックリンクは既存のアカウントにしか飛ばない。
 * 間隔を置かないと、他人の受信箱をこのサーバから埋められる。
 */
export const RESEND_INTERVAL_MINUTES = 3;

/* --------------------------------------------------------------------------
   発行
   -------------------------------------------------------------------------- */

/**
 * 確認のリンクを送る。
 *
 * 何が起きても呼ぶ側へは同じ返事をする。
 * 「送った」「すでに登録がある」「間隔の中なので送っていない」を出し分けると、
 * アドレスを打ち込むだけで、その状態を外から測れてしまう。
 */
export async function startSignup(rawEmail: string): Promise<void> {
  const parsed = emailShape.safeParse(rawEmail);
  if (!parsed.success) {
    return;
  }
  const email = normalizeEmail(parsed.data);

  const { token, hash } = issueToken();

  const issued = await transaction(async (client) => {
    /*
     * 直近の一本を掴んでから見る。
     * 掴まずに数えると、二重に押されたときに二通とも通る。
     */
    const recent = await client.query<{ within: boolean }>(
      `SELECT (created_at > now() - ($2 || ' minutes')::interval) AS within
         FROM signup_tokens
        WHERE email = $1
          AND used_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
          FOR UPDATE`,
      [email, String(RESEND_INTERVAL_MINUTES)],
    );

    if (recent.rows[0]?.within) {
      return false;
    }

    /*
     * 使われていない古い行は消す。有効なリンクを常に一本だけにしておく。
     * 使われなかったトークンに、残しておく値がない。
     */
    await client.query(`DELETE FROM signup_tokens WHERE email = $1 AND used_at IS NULL`, [
      email,
    ]);

    await client.query(
      `INSERT INTO signup_tokens (email, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [email, hash, expiresAt()],
    );
    return true;
  });

  if (!issued) {
    return;
  }

  // メールはトランザクションの外で送る。
  // 中で送ると、後の失敗で行が消えたあとも、届いたリンクだけが残る。
  await sendSignupLink(email, token);
}

/* --------------------------------------------------------------------------
   下見
   -------------------------------------------------------------------------- */

/** 使えないリンクの理由。画面はこれを文言に変える。 */
export type SignupProblem = 'invalid' | 'expired' | 'used';

const preview = z.object({
  email: z.string(),
  /** そのアドレスのアカウントがまだ無い。あるなら表示名もパスワードも訊かない。 */
  needsAccount: z.boolean(),
  expiresAt: z.date(),
});

export type SignupPreview = z.infer<typeof preview>;

export type SignupPreviewResult =
  | { readonly ok: true; readonly preview: SignupPreview }
  | { readonly ok: false; readonly reason: SignupProblem };

/**
 * リンクの中身を見る。組織を作る画面を出すためだけに使う。
 *
 * ここでは何も変えない。
 * 開いた時点で消費すると、リンクを先読みするメールソフトに使い切られる。
 */
export async function previewSignup(token: string): Promise<SignupPreviewResult> {
  const result = await pool.query(
    `SELECT s.email,
            NOT EXISTS (
              SELECT 1 FROM users u
               WHERE u.email = s.email AND u.deleted_at IS NULL) AS "needsAccount",
            s.expires_at AS "expiresAt",
            (s.used_at IS NOT NULL) AS used,
            (s.expires_at <= now()) AS expired
       FROM signup_tokens s
      WHERE s.token_hash = $1`,
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

/* --------------------------------------------------------------------------
   完了
   -------------------------------------------------------------------------- */

export type CompleteSignupInput = {
  readonly organizationName: string;
  readonly slug: string;
  readonly displayName?: string | undefined;
  readonly password?: string | undefined;
};

/** 組織を作れなかった理由。作る側から借りる。 */
type CreateProblem = Extract<CreateOrganizationResult, { ok: false }>['reason'];

export type CompleteSignupResult =
  | { readonly ok: true; readonly slug: string; readonly session: IssuedSession }
  | {
      readonly ok: false;
      readonly reason:
        | SignupProblem
        | CreateProblem
        | 'display-name-required'
        | 'password-too-short';
    };

/**
 * 組織を作って、そのまま入る。
 *
 * アカウントの用意、組織と所属の作成、トークンの消し込み、セッションの記録を
 * ひとつのトランザクションで行う。
 *
 * slug が埋まっていたときはトークンを消費しない。
 * 消費すると、名前をひとつ選び損ねただけの人が、
 * メールを受け取り直すところからやり直すことになる。
 *
 * Cookie はここでは扱わない。呼ぶ側が setSessionCookie を呼ぶ。
 */
export async function completeSignup(
  token: string,
  input: CompleteSignupInput,
  meta: { userAgent?: string | undefined; ip?: string | undefined } = {},
): Promise<CompleteSignupResult> {
  const displayName = input.displayName?.trim() ?? '';
  const password = input.password ?? '';

  const held = await previewSignup(token);
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

  // ハッシュ化は重い。接続を握ったまま数百ミリ秒待たないよう、外で済ませる。
  const passwordHash = held.preview.needsAccount ? await hashPassword(password) : null;

  return transaction<CompleteSignupResult>(async (client) => {
    const { rows } = await client.query<{
      id: string;
      email: string;
      used: boolean;
      expired: boolean;
    }>(
      `SELECT id,
              email,
              (used_at IS NOT NULL) AS used,
              (expires_at <= now()) AS expired
         FROM signup_tokens
        WHERE token_hash = $1
          FOR UPDATE`,
      [hashToken(token)],
    );

    const found = rows[0];
    if (!found) {
      return { ok: false, reason: 'invalid' };
    }
    const problem = problemOf(found);
    if (problem) {
      return { ok: false, reason: problem };
    }

    const account = await findOrCreateUser(client, found.email, displayName, passwordHash);

    const created = await createOrganizationWithin(client, account.id, {
      name: input.organizationName,
      slug: input.slug,
    });
    if (!created.ok) {
      /*
       * ここで抜けると、トランザクションごと巻き戻る。
       * 作りかけのアカウントも、消し込みも残らない。同じリンクで入れ直せる。
       */
      throw new SignupRollback(created.reason);
    }

    await client.query(`UPDATE signup_tokens SET used_at = now() WHERE id = $1`, [found.id]);

    // リンクを踏めたことが、そのアドレスの持ち主である証拠になっている。
    // 招待の受諾と同じく、ここでロックを解く。
    await clearLoginFailures(account.id, client);
    const session = await createSessionRecord(account.id, meta, client);

    return { ok: true, slug: created.slug, session };
  }).catch((err: unknown) => {
    if (err instanceof SignupRollback) {
      return { ok: false, reason: err.reason } as CompleteSignupResult;
    }
    throw err;
  });
}

/* --------------------------------------------------------------------------
   中で使うもの
   -------------------------------------------------------------------------- */

/**
 * 組織を作れなかったことを、トランザクションの外へ運ぶ。
 *
 * 値を返して抜けると COMMIT される。
 * 作りかけのアカウントを残さないため、例外で巻き戻す。
 */
class SignupRollback extends Error {
  /*
   * 引数のプロパティ宣言（constructor(readonly reason)）は使わない。
   * node の型剥がしが受け付けず、テストと pnpm org:create が読み込めなくなる。
   */
  readonly reason: CreateProblem;

  constructor(reason: CreateProblem) {
    super(reason);
    this.name = 'SignupRollback';
    this.reason = reason;
  }
}

function problemOf(row: { used: boolean; expired: boolean }): SignupProblem | null {
  if (row.used) {
    return 'used';
  }
  if (row.expired) {
    return 'expired';
  }
  return null;
}

/**
 * 登録するアドレスのアカウントを用意する。
 *
 * すでにある場合、表示名にもパスワードにも触らない。
 * 触れると、リンクを踏ませるだけで他人のアカウントを書き換えられる。
 *
 * 論理削除されたアカウントは無いものとして扱い、新しく作る。
 * 一意索引が deleted_at IS NULL に限ってあるので、同じアドレスで作れる。
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
