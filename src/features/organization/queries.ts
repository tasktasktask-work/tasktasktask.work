import type pg from 'pg';
import { z } from 'zod';
import {
  isUniqueViolation,
  type OrgScope,
  orgAdminExists,
  orgFrozenExpr,
  orgNotFrozen,
  pool,
  transaction,
} from '#lib/db.ts';
import { billingMode } from '#lib/env.ts';
import { many, one } from '#lib/row.ts';
import { checkSlug, type SlugProblem } from './slug.ts';

/* ==========================================================================
   組織と所属の読み書き

   組織は分類のラベルではなく、データの境界である。
   ページが組織のデータに触れる前に、必ず resolveScope を通る。
   ここで所属を確かめられなければ、その先には何も渡らない。

   仕様は docs/features/organization/index.html にある。
   ========================================================================== */

export const memberRole = z.enum(['admin', 'member']);
export type MemberRole = z.infer<typeof memberRole>;

/* --------------------------------------------------------------------------
   所属の確認
   -------------------------------------------------------------------------- */

const membership = z.object({
  organizationId: z.uuid(),
  slug: z.string(),
  name: z.string(),
  role: memberRole,
});

export type Membership = z.infer<typeof membership>;

/**
 * その人が属している組織。
 *
 * ログイン直後の行き先を決めるのと、組織の切り替えに使う。
 * 一件も無い状態はありうる。組織から全て外された人がそれである。
 */
export async function listMemberships(userId: string): Promise<Membership[]> {
  const result = await pool.query(
    `SELECT o.id   AS "organizationId",
            o.slug,
            o.name,
            m.role
       FROM organization_members m
       JOIN organizations o ON o.id = m.organization_id AND o.deleted_at IS NULL
      WHERE m.user_id = $1
        AND m.deleted_at IS NULL
      ORDER BY o.name`,
    [userId],
  );
  return many(membership, result, 'listMemberships');
}

const scopeRow = z.object({
  organizationId: z.uuid(),
  timezone: z.string(),
  role: memberRole,
  frozen: z.boolean(),
});

/**
 * URL の slug から組織のスコープを組み立てる。所属していなければ null。
 *
 * slug は利用者が打ち込める値である。
 * 「その組織は存在しない」と「あなたは所属していない」を出し分けない。
 * 分けると、slug を総当たりして他社の存在と名前を確かめられる。
 *
 * isOrgAdmin はここで一度だけ決める。
 * ただし書き込みの側はこの値を信用せず、SQL の中でもう一度確かめる。
 * 呼ぶ側が組み立てたスコープを渡せてしまうためである。
 *
 * 凍結も同じ扱いにする。ここで一度引いて画面の出し分けに使い、
 * 書き込みの SQL では orgNotFrozen をもう一度通す。
 */
export async function resolveScope(userId: string, slug: string): Promise<OrgScope | null> {
  const result = await pool.query(
    `SELECT o.id AS "organizationId",
            o.timezone,
            m.role,
            ${orgFrozenExpr('o')} AS frozen
       FROM organizations o
       JOIN organization_members m
         ON m.organization_id = o.id
        AND m.user_id = $2
        AND m.deleted_at IS NULL
      WHERE o.slug = $1
        AND o.deleted_at IS NULL`,
    [slug, userId],
  );

  const row = one(scopeRow, result, 'resolveScope');
  if (!row) {
    return null;
  }

  return {
    organizationId: row.organizationId,
    userId,
    isOrgAdmin: row.role === 'admin',
    timezone: row.timezone,
    // BILLING_MODE=off のときは、判定そのものを行わない
    frozen: billingMode() === 'off' ? false : row.frozen,
  };
}

/* --------------------------------------------------------------------------
   組織そのもの
   -------------------------------------------------------------------------- */

export type CreateOrganizationInput = { readonly name: string; readonly slug: string };

export type CreateOrganizationResult =
  | { readonly ok: true; readonly organizationId: string; readonly slug: string }
  | { readonly ok: false; readonly reason: 'invalid-name' | SlugProblem | 'slug-taken' };

/**
 * 組織と、作った人の所属をひとつ作る。
 *
 * 組織を作る道は二つある。画面（/signup）と pnpm org:create である。
 * どちらもこの関数を通る。分けて書くと、片方にだけ検証が増える。
 *
 * 作った人は必ず組織管理者になる。
 * 管理者のいない組織は、中の誰にも設定を触れない器でしかない。
 */
export async function createOrganization(
  userId: string,
  input: CreateOrganizationInput,
): Promise<CreateOrganizationResult> {
  return transaction((client) => createOrganizationWithin(client, userId, input));
}

/**
 * すでに開いているトランザクションの中で組織を作る。
 *
 * 登録（signup.ts）はアカウントの作成と同じトランザクションで作る必要がある。
 * 途中で失敗して「アカウントだけできた」を残さないためである。
 */
export async function createOrganizationWithin(
  client: pg.PoolClient,
  userId: string,
  input: CreateOrganizationInput,
): Promise<CreateOrganizationResult> {
  const name = input.name.trim();
  if (name === '') {
    return { ok: false, reason: 'invalid-name' };
  }

  const checked = checkSlug(input.slug);
  if (!checked.ok) {
    return { ok: false, reason: checked.reason };
  }

  let organizationId: string | undefined;
  try {
    const created = await client.query<{ id: string }>(
      `INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id`,
      [name, checked.slug],
    );
    organizationId = created.rows[0]?.id;
  } catch (err) {
    /*
     * organizations_slug_key に当たった。
     * 先に確かめてから入れる形にはしない。確かめた後、入れる前に取られる。
     */
    if (isUniqueViolation(err)) {
      return { ok: false, reason: 'slug-taken' };
    }
    throw err;
  }

  if (!organizationId) {
    throw new Error(`組織を作れませんでした: ${checked.slug}`);
  }

  await client.query(
    `INSERT INTO organization_members (organization_id, user_id, role)
     VALUES ($1, $2, 'admin')`,
    [organizationId, userId],
  );

  return { ok: true, organizationId, slug: checked.slug };
}

const organization = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  language: z.string(),
  timezone: z.string(),
  createdAt: z.date(),
  memberCount: z.number().int(),
});

export type Organization = z.infer<typeof organization>;

export async function getOrganization(scope: OrgScope): Promise<Organization> {
  const result = await pool.query(
    `SELECT o.id,
            o.slug,
            o.name,
            o.language,
            o.timezone,
            o.created_at AS "createdAt",
            (SELECT count(*)::int
               FROM organization_members m
              WHERE m.organization_id = o.id AND m.deleted_at IS NULL) AS "memberCount"
       FROM organizations o
      WHERE o.id = $1 AND o.deleted_at IS NULL`,
    [scope.organizationId],
  );

  const row = one(organization, result, 'getOrganization');
  if (!row) {
    // スコープが作れている以上、組織は在る。無いなら別の何かが壊れている。
    throw new Error(`組織が見つかりません: ${scope.organizationId}`);
  }
  return row;
}

export type UpdateResult = { ok: true } | { ok: false; reason: 'forbidden' | 'invalid-name' };

/**
 * 組織の名前を変える。
 *
 * slug は変えられない。URL と、外に貼られたリンクがそれを指しているためである。
 * プロジェクトキーを変えられないのと同じ理由による。
 */
export async function renameOrganization(scope: OrgScope, name: string): Promise<UpdateResult> {
  const trimmed = name.trim();
  if (trimmed === '') {
    return { ok: false, reason: 'invalid-name' };
  }

  const { rowCount } = await pool.query(
    `UPDATE organizations
        SET name = $3
      WHERE id = $1
        AND deleted_at IS NULL
        AND ${orgAdminExists('$1', '$2')}
        AND ${orgNotFrozen('$1')}`,
    [scope.organizationId, scope.userId, trimmed],
  );

  return rowCount === 1 ? { ok: true } : { ok: false, reason: 'forbidden' };
}

/* --------------------------------------------------------------------------
   メンバー
   -------------------------------------------------------------------------- */

const memberRow = z.object({
  userId: z.uuid(),
  displayName: z.string(),
  /** 組織管理者にだけ見せる。それ以外には null が入る。 */
  email: z.string().nullable(),
  role: memberRole,
  joinedAt: z.date(),
  locked: z.boolean(),
});

export type MemberRow = z.infer<typeof memberRow>;

/**
 * 組織のメンバー一覧。
 *
 * メールアドレスは組織管理者にだけ返す。
 * 招待の重複や、誰を外すのかを確かめるのに要るのは管理する側だけで、
 * 表示名と役割があれば他のメンバーは困らない。
 *
 * 出し分けは SQL の中で行う。呼ぶ側が絞るとその一箇所を忘れて漏れる。
 */
export async function listMembers(scope: OrgScope): Promise<MemberRow[]> {
  const result = await pool.query(
    `SELECT u.id            AS "userId",
            u.display_name  AS "displayName",
            CASE WHEN ${orgAdminExists('$1', '$2')}
                 THEN u.email
                 ELSE NULL
             END            AS email,
            m.role,
            m.created_at    AS "joinedAt",
            (u.locked_at IS NOT NULL) AS locked
       FROM organization_members m
       JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
      WHERE m.organization_id = $1
        AND m.deleted_at IS NULL
      ORDER BY m.role, u.display_name`,
    [scope.organizationId, scope.userId],
  );
  return many(memberRow, result, 'listMembers');
}

export type MemberChange =
  | { ok: true }
  | { ok: false; reason: 'forbidden' | 'not-member' | 'last-admin' | 'frozen' };

/**
 * 凍結されているかどうかを、トランザクションの中で確かめる。
 *
 * 役割の変更とメンバーの削除は、行を掴んでから条件を見る形になっている。
 * 掴む前に判定を挟むと、掴んだあとに凍結された場合をすり抜ける。
 */
async function frozenNow(client: pg.PoolClient, organizationId: string): Promise<boolean> {
  if (billingMode() === 'off') {
    return false;
  }
  const { rows } = await client.query<{ frozen: boolean }>(
    `SELECT ${orgFrozenExpr('o')} AS frozen FROM organizations o WHERE o.id = $1`,
    [organizationId],
  );
  return rows[0]?.frozen ?? false;
}

/**
 * 役割を変える。
 *
 * 最後の組織管理者を降ろせない。
 * 降ろせてしまうと、その組織は設定もメンバーも触れなくなり、
 * 中の誰にも戻す手段がなくなる。
 */
export async function changeMemberRole(
  scope: OrgScope,
  targetUserId: string,
  role: MemberRole,
): Promise<MemberChange> {
  return transaction(async (client) => {
    const admins = await lockAdmins(client, scope);
    if (admins === null) {
      return { ok: false, reason: 'forbidden' };
    }

    if (await frozenNow(client, scope.organizationId)) {
      return { ok: false, reason: 'frozen' };
    }

    const target = await currentRole(client, scope.organizationId, targetUserId);
    if (target === null) {
      return { ok: false, reason: 'not-member' };
    }
    if (target === role) {
      return { ok: true };
    }
    if (target === 'admin' && admins.length <= 1) {
      return { ok: false, reason: 'last-admin' };
    }

    await client.query(
      `UPDATE organization_members
          SET role = $3
        WHERE organization_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [scope.organizationId, targetUserId, role],
    );
    return { ok: true };
  });
}

/**
 * メンバーを外す。
 *
 * 所属を切れば、その人には組織の何も見えなくなる。
 * VISIBLE_PROJECT_IDS が所属を最も外側で確かめているためである。
 *
 * それでも project_members の行を一緒に畳むのは、
 * 残しておく意味がないからで、権限のためではない。
 */
export async function removeMember(
  scope: OrgScope,
  targetUserId: string,
): Promise<MemberChange> {
  return transaction(async (client) => {
    const admins = await lockAdmins(client, scope);
    if (admins === null) {
      return { ok: false, reason: 'forbidden' };
    }

    if (await frozenNow(client, scope.organizationId)) {
      return { ok: false, reason: 'frozen' };
    }

    const target = await currentRole(client, scope.organizationId, targetUserId);
    if (target === null) {
      return { ok: false, reason: 'not-member' };
    }
    if (target === 'admin' && admins.length <= 1) {
      return { ok: false, reason: 'last-admin' };
    }

    await client.query(
      `UPDATE organization_members
          SET deleted_at = now()
        WHERE organization_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [scope.organizationId, targetUserId],
    );

    await client.query(
      `UPDATE project_members pm
          SET deleted_at = now()
         FROM projects p
        WHERE p.id = pm.project_id
          AND p.organization_id = $1
          AND pm.user_id = $2
          AND pm.deleted_at IS NULL`,
      [scope.organizationId, targetUserId],
    );

    return { ok: true };
  });
}

/**
 * 組織管理者の行に鍵をかけ、その一覧を返す。管理者でなければ null。
 *
 * 数えてから変えるまでのあいだに、別の要求が同じことをすると
 * 「どちらも、自分以外にもう一人いる」と判断して二人とも降ろせてしまう。
 * 先に行を掴んでおけば、二つめは一つめが終わるまで待つ。
 *
 * 管理者が増える側は待たせない。増えるぶんには制約を破らないためである。
 */
async function lockAdmins(client: pg.PoolClient, scope: OrgScope): Promise<string[] | null> {
  const { rows } = await client.query<{ user_id: string }>(
    `SELECT user_id
       FROM organization_members
      WHERE organization_id = $1
        AND role = 'admin'
        AND deleted_at IS NULL
      ORDER BY user_id
        FOR UPDATE`,
    [scope.organizationId],
  );

  // 呼ぶ側の isOrgAdmin は信用しない。掴んだ行の中に居るかどうかで判定する。
  if (!rows.some((row) => row.user_id === scope.userId)) {
    return null;
  }
  return rows.map((row) => row.user_id);
}

async function currentRole(
  client: pg.PoolClient,
  organizationId: string,
  userId: string,
): Promise<MemberRole | null> {
  const { rows } = await client.query<{ role: MemberRole }>(
    `SELECT m.role
       FROM organization_members m
       JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
      WHERE m.organization_id = $1 AND m.user_id = $2 AND m.deleted_at IS NULL`,
    [organizationId, userId],
  );
  return rows[0]?.role ?? null;
}
