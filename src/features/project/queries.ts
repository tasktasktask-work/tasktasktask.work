import { z } from 'zod';
import {
  type OrgScope,
  orgAdminExists,
  orgMemberExists,
  pool,
  projectAdminExists,
  transaction,
  VISIBLE_PROJECT_IDS,
} from '#lib/db.ts';
import { many, one } from '#lib/row.ts';

/* ==========================================================================
   プロジェクトの読み書き

   プロジェクトは分類ではなく境界である。
   閲覧範囲、ガントの範囲、メンションの候補、親子関係の範囲が、
   すべてこの一行に紐づいている。

   閲覧の判定は VISIBLE_PROJECT_IDS にしか書かない。
   ここに書き写すと、片方だけ直したときに穴が開く。

   仕様は docs/features/project/index.html にある。
   ========================================================================== */

export const projectVisibility = z.enum(['public', 'private']);
export type ProjectVisibility = z.infer<typeof projectVisibility>;

/**
 * 操作が通らなかった理由。
 *
 * 画面はこれを日本語に直して出す。
 * 「できませんでした」で済ませると、キーが重複しているのか
 * 権限が無いのかが分からず、利用者は同じ操作を繰り返すことになる。
 */
export type ProjectProblem =
  | 'forbidden'
  | 'not-found'
  | 'not-archived'
  | 'invalid-key'
  | 'duplicate-key'
  | 'invalid-name'
  | 'not-org-member'
  | 'already-member'
  | 'not-member';

export type ProjectChange = { ok: true } | { ok: false; reason: ProjectProblem };

/* --------------------------------------------------------------------------
   一覧
   -------------------------------------------------------------------------- */

const projectRow = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  visibility: projectVisibility,
  archived: z.boolean(),
  kadai: z.number().int(),
  giron: z.number().int(),
  shitsumon: z.number().int(),
});

export type ProjectRow = z.infer<typeof projectRow>;

/**
 * 閲覧できるプロジェクトを並べる。
 *
 * アーカイブ済みも既定で出す。
 * スレッド一覧では既定で隠しているが、桁が違う。
 * 数万件の中に混ざると読めなくなるのに対し、プロジェクトは数個しかない。
 */
export async function listProjects(
  scope: OrgScope,
  options: { includeArchived?: boolean } = {},
): Promise<ProjectRow[]> {
  const result = await pool.query(
    `SELECT p.id,
            p.key,
            p.name,
            p.description,
            p.visibility,
            (p.archived_at IS NOT NULL) AS archived,
            n.kadai,
            n.giron,
            n.shitsumon
       FROM projects p
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE t.type = 'kadai')::int     AS kadai,
                count(*) FILTER (WHERE t.type = 'giron')::int     AS giron,
                count(*) FILTER (WHERE t.type = 'shitsumon')::int AS shitsumon
           FROM threads t
          WHERE t.project_id = p.id AND t.deleted_at IS NULL
       ) n ON true
      WHERE p.id IN (${VISIBLE_PROJECT_IDS})
        AND ($3 OR p.archived_at IS NULL)
      -- 生きているものが先。その中はキーの順で、並びが日によって変わらないようにする。
      ORDER BY (p.archived_at IS NOT NULL), p.key`,
    [scope.organizationId, scope.userId, options.includeArchived ?? true],
  );
  return many(projectRow, result, 'listProjects');
}

const projectLink = z.object({ key: z.string(), name: z.string() });

export type ProjectLink = z.infer<typeof projectLink>;

/**
 * 左帯に並べるぶんだけ。件数は数えない。
 *
 * 一覧と同じ関数を使うと、メンバーの画面を開くたびにスレッドを数えることになる。
 * 左帯に出るのは名前とキーだけである。
 *
 * 畳んだプロジェクトは出さない。左帯は行き先を選ぶ場所で、
 * 終わったものが常に並んでいると、生きているものが埋もれる。
 */
export async function listProjectLinks(scope: OrgScope): Promise<ProjectLink[]> {
  const result = await pool.query(
    `SELECT p.key, p.name
       FROM projects p
      WHERE p.id IN (${VISIBLE_PROJECT_IDS})
        AND p.archived_at IS NULL
      ORDER BY p.key`,
    [scope.organizationId, scope.userId],
  );
  return many(projectLink, result, 'listProjectLinks');
}

/* --------------------------------------------------------------------------
   一件
   -------------------------------------------------------------------------- */

const projectDetail = projectRow.extend({
  memberCount: z.number().int(),
  /**
   * このプロジェクトを管理できるか。組織管理者は常に真。
   *
   * 名前、説明文、公開設定、アーカイブ、メンバーの出し入れ。
   * 削除だけは含まない。そこは組織管理者に残してある。
   */
  canManage: z.boolean(),
});

export type ProjectDetail = z.infer<typeof projectDetail>;

/**
 * URL のキーからプロジェクトを引く。閲覧できなければ null。
 *
 * 存在しないキーと、見えないプロジェクトを区別しない。
 * 区別すると、キーを総当たりして非公開プロジェクトの存在を確かめられる。
 * slug で同じことをしないのと同じ理由による。
 */
export async function resolveProject(
  scope: OrgScope,
  key: string,
): Promise<ProjectDetail | null> {
  const result = await pool.query(
    `SELECT p.id,
            p.key,
            p.name,
            p.description,
            p.visibility,
            (p.archived_at IS NOT NULL) AS archived,
            n.kadai,
            n.giron,
            n.shitsumon,
            (SELECT count(*)::int
               FROM project_members pm
              WHERE pm.project_id = p.id AND pm.deleted_at IS NULL) AS "memberCount",
            ${projectAdminExists('p.id', 'p.organization_id', '$2')} AS "canManage"
       FROM projects p
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE t.type = 'kadai')::int     AS kadai,
                count(*) FILTER (WHERE t.type = 'giron')::int     AS giron,
                count(*) FILTER (WHERE t.type = 'shitsumon')::int AS shitsumon
           FROM threads t
          WHERE t.project_id = p.id AND t.deleted_at IS NULL
       ) n ON true
      WHERE p.id IN (${VISIBLE_PROJECT_IDS})
        AND p.key = $3`,
    [scope.organizationId, scope.userId, key.toUpperCase()],
  );
  return one(projectDetail, result, 'resolveProject');
}

/* --------------------------------------------------------------------------
   作成
   -------------------------------------------------------------------------- */

export type CreateProject = {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly visibility: ProjectVisibility;
};

export type CreateResult = { ok: true; key: string } | { ok: false; reason: ProjectProblem };

/**
 * プロジェクトを作る。組織管理者だけが作れる。
 *
 * 作った人を、そのままプロジェクト管理者として登録する。
 * 公開で作った場合でも登録するのは、あとで非公開に切り替えたときに
 * 誰も居ない非公開プロジェクトができるのを避けるためである。
 */
export async function createProject(
  scope: OrgScope,
  input: CreateProject,
): Promise<CreateResult> {
  const key = input.key.trim().toUpperCase();
  const name = input.name.trim();

  if (name === '') {
    return { ok: false, reason: 'invalid-name' };
  }
  // キーの形は CHECK 制約でも守られているが、先に見る。
  // 制約違反の例外を握って理由に直すより、そのまま返したほうが読める。
  if (!/^[A-Z0-9]{2,10}$/.test(key)) {
    return { ok: false, reason: 'invalid-key' };
  }

  try {
    return await transaction(async (client) => {
      const created = await client.query<{ id: string; key: string }>(
        `INSERT INTO projects
           (organization_id, key, name, description, visibility, created_by_user_id)
         SELECT $1, $3, $4, $5, $6, $2
          WHERE ${orgAdminExists('$1', '$2')}
         RETURNING id, key`,
        [
          scope.organizationId,
          scope.userId,
          key,
          name,
          input.description.trim(),
          input.visibility,
        ],
      );

      const row = created.rows[0];
      if (!row) {
        return { ok: false, reason: 'forbidden' };
      }

      await client.query(
        `INSERT INTO project_members (project_id, user_id, is_admin) VALUES ($1, $2, true)`,
        [row.id, scope.userId],
      );

      return { ok: true, key: row.key };
    });
  } catch (err) {
    // 同じキーのプロジェクトが、削除されずに残っている
    if (isUniqueViolation(err)) {
      return { ok: false, reason: 'duplicate-key' };
    }
    throw err;
  }
}

/* --------------------------------------------------------------------------
   設定
   -------------------------------------------------------------------------- */

/**
 * 名前と説明文を変える。プロジェクトを管理できる人が変えられる。
 *
 * キーは変えられない。
 * WEB-128 として議事録やコミットメッセージに書かれたものが
 * ある日から FRONT-128 になると、過去の記録と照合できなくなる。
 */
export async function renameProject(
  scope: OrgScope,
  projectId: string,
  name: string,
  description: string,
): Promise<ProjectChange> {
  const trimmed = name.trim();
  if (trimmed === '') {
    return { ok: false, reason: 'invalid-name' };
  }

  const { rowCount } = await pool.query(
    `UPDATE projects p
        SET name = $4, description = $5, updated_at = now()
      WHERE p.id = $3
        AND p.organization_id = $1
        AND p.deleted_at IS NULL
        AND ${projectAdminExists('p.id', 'p.organization_id', '$2')}`,
    [scope.organizationId, scope.userId, projectId, trimmed, description.trim()],
  );

  return rowCount === 1 ? { ok: true } : { ok: false, reason: 'forbidden' };
}

/**
 * 公開と非公開を切り替える。プロジェクトを管理できる人が切り替えられる。
 *
 * 非公開から公開へ戻すことはできても、見られた事実は戻せない。
 * 確認をはさむのは画面の側の仕事である。
 *
 * この人はすでに非公開の顔ぶれを決められる。
 * 組織のメンバーを一人ずつ足していけば公開とほぼ同じ状態を作れるので、
 * 切り替えだけを止めても守りにはならない。
 */
export async function changeVisibility(
  scope: OrgScope,
  projectId: string,
  visibility: ProjectVisibility,
): Promise<ProjectChange> {
  const { rowCount } = await pool.query(
    `UPDATE projects p
        SET visibility = $4, updated_at = now()
      WHERE p.id = $3
        AND p.organization_id = $1
        AND p.deleted_at IS NULL
        AND ${projectAdminExists('p.id', 'p.organization_id', '$2')}`,
    [scope.organizationId, scope.userId, projectId, visibility],
  );

  return rowCount === 1 ? { ok: true } : { ok: false, reason: 'forbidden' };
}

/**
 * 畳む、あるいは戻す。プロジェクトを管理できる人が行える。
 *
 * 終わったかどうかを知っているのは、そのプロジェクトを回している人である。
 * 戻せる操作でもあるので、組織管理者を待たせる理由がない。
 *
 * 畳むと配下のスレッドがまとめて読み取り専用になる。
 * 個々のスレッドの archived_at は書き換えない。
 * 書き換えると、戻したときに元々畳んであったものまで開いてしまう。
 */
export async function setArchived(
  scope: OrgScope,
  projectId: string,
  archived: boolean,
): Promise<ProjectChange> {
  const { rowCount } = await pool.query(
    `UPDATE projects p
        SET archived_at = CASE WHEN $4 THEN now() ELSE NULL END,
            updated_at = now()
      WHERE p.id = $3
        AND p.organization_id = $1
        AND p.deleted_at IS NULL
        AND ${projectAdminExists('p.id', 'p.organization_id', '$2')}`,
    [scope.organizationId, scope.userId, projectId, archived],
  );

  return rowCount === 1 ? { ok: true } : { ok: false, reason: 'forbidden' };
}

/**
 * 論理削除する。組織管理者だけが、畳んだあとにだけ行える。
 *
 * 設定の他の項目と違って、ここだけ組織管理者に残してある。
 * 論理削除はどのテーブルでも組織管理者に寄せてあり、
 * 中のスレッドごと視界から消える操作を、この機能だけ広げる理由がない。
 *
 * 二段にしてあるのは、一覧から一度で消せないようにするためである。
 * 中のスレッドごと視界から消える操作を、確認の一枚だけで通したくない。
 */
export async function deleteProject(
  scope: OrgScope,
  projectId: string,
): Promise<ProjectChange> {
  const { rowCount } = await pool.query(
    `UPDATE projects
        SET deleted_at = now(), updated_at = now()
      WHERE id = $3
        AND organization_id = $1
        AND deleted_at IS NULL
        AND archived_at IS NOT NULL
        AND ${orgAdminExists('$1', '$2')}`,
    [scope.organizationId, scope.userId, projectId],
  );
  if (rowCount === 1) {
    return { ok: true };
  }

  // 通らなかった理由を、もう一度読んで確かめる。
  // 失敗したときだけ余分に一回だけ引くので、通常の経路は一回のままである。
  const { rows } = await pool.query<{ archived: boolean; admin: boolean }>(
    `SELECT (p.archived_at IS NOT NULL) AS archived,
            ${orgAdminExists('$1', '$2')} AS admin
       FROM projects p
      WHERE p.id = $3 AND p.organization_id = $1 AND p.deleted_at IS NULL`,
    [scope.organizationId, scope.userId, projectId],
  );

  const row = rows[0];
  if (!row) {
    return { ok: false, reason: 'not-found' };
  }
  if (!row.admin) {
    return { ok: false, reason: 'forbidden' };
  }
  return { ok: false, reason: 'not-archived' };
}

/* --------------------------------------------------------------------------
   非公開プロジェクトのメンバー
   -------------------------------------------------------------------------- */

const projectMemberRow = z.object({
  userId: z.uuid(),
  displayName: z.string(),
  isAdmin: z.boolean(),
  addedAt: z.date(),
});

export type ProjectMemberRow = z.infer<typeof projectMemberRow>;

/**
 * プロジェクトに登録されている人。
 *
 * 組織管理者はここに並ばない。行を持たなくても管理者として扱われるためである。
 * 「一覧に居ないのに見えている人が居る」と読めてしまうので、画面の側で断る。
 */
export async function listProjectMembers(
  scope: OrgScope,
  projectId: string,
): Promise<ProjectMemberRow[]> {
  const result = await pool.query(
    `SELECT u.id           AS "userId",
            u.display_name AS "displayName",
            pm.is_admin    AS "isAdmin",
            pm.created_at  AS "addedAt"
       FROM project_members pm
       JOIN users u ON u.id = pm.user_id AND u.deleted_at IS NULL
      WHERE pm.project_id = $3
        AND pm.deleted_at IS NULL
        AND pm.project_id IN (${VISIBLE_PROJECT_IDS})
        -- 組織から外れた人の行は残っていても並べない。もう何も見えていない。
        AND ${orgMemberExists('$1', 'pm.user_id')}
      ORDER BY pm.is_admin DESC, u.display_name`,
    [scope.organizationId, scope.userId, projectId],
  );
  return many(projectMemberRow, result, 'listProjectMembers');
}

/**
 * メンバーを足す。組織管理者か、プロジェクト管理者が行える。
 *
 * 一度外した人を呼び戻すときは、畳んだ行を起こさずに新しい行を足す。
 * 出入りを繰り返した人には畳んだ行が何本も並んでいて、
 * まとめて起こすと生きた行が二本になり、部分一意索引に弾かれる。
 */
export async function addProjectMember(
  scope: OrgScope,
  projectId: string,
  targetUserId: string,
  isAdmin: boolean,
): Promise<ProjectChange> {
  return transaction(async (client) => {
    const allowed = await client.query(
      `SELECT 1
         FROM projects p
        WHERE p.id = $3
          AND p.organization_id = $1
          AND p.deleted_at IS NULL
          AND ${projectAdminExists('p.id', 'p.organization_id', '$2')}`,
      [scope.organizationId, scope.userId, projectId],
    );
    if (allowed.rowCount === 0) {
      return { ok: false, reason: 'forbidden' };
    }

    // 組織のメンバーでない人は足せない。組織が境界である。
    const member = await client.query(
      `SELECT 1 FROM users u
        WHERE u.id = $2 AND u.deleted_at IS NULL AND ${orgMemberExists('$1', 'u.id')}`,
      [scope.organizationId, targetUserId],
    );
    if (member.rowCount === 0) {
      return { ok: false, reason: 'not-org-member' };
    }

    const revived = await client.query(
      `UPDATE project_members
          SET is_admin = $3, updated_at = now()
        WHERE project_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [projectId, targetUserId, isAdmin],
    );
    if (revived.rowCount === 0) {
      await client.query(
        `INSERT INTO project_members (project_id, user_id, is_admin) VALUES ($1, $2, $3)`,
        [projectId, targetUserId, isAdmin],
      );
    }

    return { ok: true };
  });
}

/**
 * メンバーを外す。
 *
 * 最後のプロジェクト管理者を守る必要はない。
 * 組織管理者が常に管理者として扱われるので、行が一本も無くなっても
 * そのプロジェクトが誰にも触れなくなることはない。
 */
export async function removeProjectMember(
  scope: OrgScope,
  projectId: string,
  targetUserId: string,
): Promise<ProjectChange> {
  const { rowCount } = await pool.query(
    `UPDATE project_members pm
        SET deleted_at = now(), updated_at = now()
       FROM projects p
      WHERE p.id = pm.project_id
        AND p.id = $3
        AND p.organization_id = $1
        AND p.deleted_at IS NULL
        AND pm.user_id = $4
        AND pm.deleted_at IS NULL
        AND ${projectAdminExists('p.id', 'p.organization_id', '$2')}`,
    [scope.organizationId, scope.userId, projectId, targetUserId],
  );

  if (rowCount === 1) {
    return { ok: true };
  }

  // 権限が無いのか、そもそも登録されていないのか。
  // どちらも「外せなかった」だが、画面に出す言葉が変わる。
  const { rows } = await pool.query<{ allowed: boolean; member: boolean }>(
    `SELECT ${projectAdminExists('p.id', 'p.organization_id', '$2')} AS allowed,
            EXISTS (SELECT 1 FROM project_members pm
                     WHERE pm.project_id = p.id
                       AND pm.user_id = $4
                       AND pm.deleted_at IS NULL) AS member
       FROM projects p
      WHERE p.id = $3 AND p.organization_id = $1 AND p.deleted_at IS NULL`,
    [scope.organizationId, scope.userId, projectId, targetUserId],
  );

  const row = rows[0];
  if (!row?.allowed) {
    return { ok: false, reason: 'forbidden' };
  }
  return { ok: false, reason: 'not-member' };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === '23505';
}
