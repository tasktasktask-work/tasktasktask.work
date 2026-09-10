import type { PoolClient } from 'pg';
import { z } from 'zod';
import { threadWritable } from '#features/thread/queries.ts';
import {
  type OrgScope,
  orgNotFrozen,
  pool,
  transaction,
  VISIBLE_PROJECT_IDS,
} from '#lib/db.ts';
import { many } from '#lib/row.ts';
import { attachTagsTo } from './attach.ts';
import { isTagColor, NAME_MAX } from './colors.ts';

/* ==========================================================================
   タグ

   組織の単位で定義し、プロジェクトをまたいで使う。誰でも作れる。
   仕様は docs/features/tag/index.html にある。

   スレッドとの結び（thread_tags）は物理削除である。
   付け外しが日常的に起きるので、外した行を残すと中間テーブルが
   「いま付いているもの」を答えられなくなる。
   ========================================================================== */

export type TagProblem =
  | 'frozen'
  | 'not-found'
  | 'invalid-name'
  | 'invalid-color'
  | 'duplicate-name'
  | 'no-such-tag'
  | 'thread-not-found';

export type TagChange = { ok: true } | { ok: false; reason: TagProblem };

const tagRow = z.object({
  id: z.uuid(),
  name: z.string(),
  color: z.string(),
});

export type TagRow = z.infer<typeof tagRow>;

const adminRow = tagRow.extend({ usage: z.number().int() });

export type TagAdminRow = z.infer<typeof adminRow>;

/* --------------------------------------------------------------------------
   読む
   -------------------------------------------------------------------------- */

/**
 * 組織のタグをすべて返す。付ける側の選択肢はこれを使う。
 *
 * 絞り込みの選択肢と範囲が違う（そちらは listProjectTags）。
 * 絞り込みは「あるものを探す」、付けるのは「無いものを足す」で、
 * 要る範囲が逆になる。使われているものだけを出すと、
 * 作ったばかりのタグを最初に付ける道が無くなる。
 */
export async function listTags(scope: OrgScope): Promise<TagRow[]> {
  const result = await pool.query(
    `SELECT id, name, color
       FROM tags
      WHERE organization_id = $1 AND deleted_at IS NULL
      ORDER BY name`,
    [scope.organizationId],
  );
  return many(tagRow, result, 'listTags');
}

/**
 * 管理画面の一覧。使用数つき。
 *
 * 使用数は組織のすべてのスレッドを数える。閲覧できるものだけに絞らない。
 * ここの数字は「消したら何件から外れるか」を伝えるための歯止めなので、
 * 見える範囲に絞ると、実際に消える行数より少ない数を見せることになる。
 * 引き換えに、非公開プロジェクトでの利用が数として見える。
 * 名前と件数だけであり、何のスレッドかは分からない。
 */
export async function listTagsForAdmin(scope: OrgScope): Promise<TagAdminRow[]> {
  const result = await pool.query(
    `SELECT g.id, g.name, g.color,
            COALESCE(u.count, 0)::int AS usage
       FROM tags g
       LEFT JOIN LATERAL (
         SELECT count(*) AS count
           FROM thread_tags tt
           JOIN threads t ON t.id = tt.thread_id AND t.deleted_at IS NULL
          WHERE tt.tag_id = g.id
       ) u ON true
      WHERE g.organization_id = $1 AND g.deleted_at IS NULL
      ORDER BY g.name`,
    [scope.organizationId],
  );
  return many(adminRow, result, 'listTagsForAdmin');
}

/**
 * そのプロジェクトで実際に使われているタグ。絞り込みの選択肢に使う。
 *
 * 組織の全タグを並べると、別のプロジェクト専用のタグが混ざる。
 * 選んでも常に 0 件になる選択肢を並べても、探す助けにならない。
 */
export async function listProjectTags(scope: OrgScope, projectId: string): Promise<TagRow[]> {
  const result = await pool.query(
    `SELECT DISTINCT g.id, g.name, g.color
       FROM tags g
       JOIN thread_tags tt ON tt.tag_id = g.id
       JOIN threads t      ON t.id = tt.thread_id
      WHERE g.organization_id = $1
        AND g.deleted_at IS NULL
        AND t.deleted_at IS NULL
        AND t.project_id = $3
        AND t.project_id IN (${VISIBLE_PROJECT_IDS})
      ORDER BY g.name`,
    [scope.organizationId, scope.userId, projectId],
  );
  return many(tagRow, result, 'listProjectTags');
}

/**
 * そのスレッドに付いているタグ。詳細の属性欄で使う。
 *
 * 一覧の行が持つタグ（listThreads）は名前と色しか持たない。
 * 外す押しボタンとチェックの状態には id が要るので、ここで引き直す。
 */
export async function listThreadTags(scope: OrgScope, threadId: string): Promise<TagRow[]> {
  const result = await pool.query(
    `SELECT g.id, g.name, g.color
       FROM thread_tags tt
       JOIN tags g    ON g.id = tt.tag_id AND g.deleted_at IS NULL
       JOIN threads t ON t.id = tt.thread_id
      WHERE tt.thread_id = $3
        AND t.organization_id = $1
        AND t.deleted_at IS NULL
        AND t.project_id IN (${VISIBLE_PROJECT_IDS})
      ORDER BY g.name`,
    [scope.organizationId, scope.userId, threadId],
  );
  return many(tagRow, result, 'listThreadTags');
}

/* --------------------------------------------------------------------------
   タグそのものを作る、直す、消す

   誰でも触れる。組織のメンバーであることだけを見る。
   作成を管理者に限ると、必要なタグが作れないまま使われなくなる。
   -------------------------------------------------------------------------- */

/** Postgres の一意制約違反。 */
const UNIQUE_VIOLATION = '23505';

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

function checkName(name: string): TagProblem | null {
  const trimmed = name.trim();
  if (trimmed === '') {
    return 'invalid-name';
  }
  return trimmed.length > NAME_MAX ? 'invalid-name' : null;
}

/**
 * タグを作る。
 *
 * 同じ名前の消えたタグがあっても、それを起こしにはいかない。
 * 一意索引は `WHERE deleted_at IS NULL` の部分索引なので、
 * 消えた行が残っていても新しい行はそのまま入る。
 *
 * 起こす案もあったが、結びは消すとき（deleteTag）に一緒に消しているので、
 * 起こした行に付いているスレッドは一件もない。
 * 新しく入れた行と中身が一致するため、区別する意味がない。
 */
export async function createTag(
  scope: OrgScope,
  name: string,
  color: string,
): Promise<TagChange> {
  const bad = checkName(name);
  if (bad) {
    return { ok: false, reason: bad };
  }
  if (!isTagColor(color)) {
    return { ok: false, reason: 'invalid-color' };
  }

  try {
    const { rowCount } = await pool.query(
      `INSERT INTO tags (organization_id, name, color)
            SELECT $1, $2, $3 WHERE ${orgNotFrozen('$1')}`,
      [scope.organizationId, name.trim(), color],
    );
    if (rowCount !== 1) {
      return { ok: false, reason: 'frozen' };
    }
  } catch (err) {
    // 先に SELECT で確かめる形にすると、二人が同時に押したときに
    // 両方とも「無い」と読んでから両方が入れにいく。索引に判定させる。
    if (isUniqueViolation(err)) {
      return { ok: false, reason: 'duplicate-name' };
    }
    throw err;
  }
  return { ok: true };
}

/**
 * 名前と色を直す。
 *
 * 名前を変えられるようにしてあるのは、打ち間違えたタグを
 * 消して作り直すしかない状態を避けるためである。
 * thread_tags は物理削除なので、作り直しでは付け直す手掛かりが残らない。
 *
 * 同じ名前の消えたタグがあっても、それを起こしにはいかない。
 * ここは行の名前を変える操作であって、行が増えも減りもしない。
 * 起こすと、名前を直したつもりが消したタグを連れ戻すことになる。
 */
export async function updateTag(
  scope: OrgScope,
  tagId: string,
  name: string,
  color: string,
): Promise<TagChange> {
  const bad = checkName(name);
  if (bad) {
    return { ok: false, reason: bad };
  }
  if (!isTagColor(color)) {
    return { ok: false, reason: 'invalid-color' };
  }

  try {
    const { rowCount } = await pool.query(
      // updated_at は tags_set_updated_at が入れる（db/functions.sql）
      `UPDATE tags
          SET name = $3, color = $4
        WHERE id = $2 AND organization_id = $1 AND deleted_at IS NULL
          AND ${orgNotFrozen('$1')}`,
      [scope.organizationId, tagId, name.trim(), color],
    );
    return rowCount === 1 ? { ok: true } : { ok: false, reason: 'not-found' };
  } catch (err) {
    if (isUniqueViolation(err)) {
      return { ok: false, reason: 'duplicate-name' };
    }
    throw err;
  }
}

/**
 * タグを消す。付いていたスレッドとの結びも一緒に消す。
 *
 * タグ自体は論理削除、結びは物理削除である。
 * 結びを残す案もあったが、残すと「同じ名前で作り直したら
 * 半年前のスレッドが一斉にタグ付きで現れる」という道ができる。
 * 消したことを取り消したい人と、同じ名前で始め直したい人が、
 * 同じ操作をすることになる。
 *
 * 取り消しは効かない。画面の側で二度押しにしてある。
 */
export async function deleteTag(scope: OrgScope, tagId: string): Promise<TagChange> {
  return transaction(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE tags
          SET deleted_at = now()
        WHERE id = $2 AND organization_id = $1 AND deleted_at IS NULL
          AND ${orgNotFrozen('$1')}`,
      [scope.organizationId, tagId],
    );
    if (rowCount !== 1) {
      return { ok: false, reason: 'not-found' };
    }

    await client.query(`DELETE FROM thread_tags WHERE tag_id = $1`, [tagId]);
    return { ok: true };
  });
}

/* --------------------------------------------------------------------------
   スレッドへの付け外し

   そのスレッドを書き換えられる人なら誰でもできる。
   担当者や期間と同じ扱いで、アーカイブ済みのスレッドには付け外しできない。
   条件は threadWritable() をそのまま使う。ここに書き写さない。
   -------------------------------------------------------------------------- */

/** そのスレッドに書き込めるか。書けないときは理由を区別せず not-found を返す。 */
async function writable(
  client: PoolClient,
  scope: OrgScope,
  threadId: string,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `SELECT 1 FROM threads t WHERE t.id = $3 AND ${threadWritable()}`,
    [scope.organizationId, scope.userId, threadId],
  );
  return rowCount === 1;
}

/**
 * 名前で指して付ける。属性欄のテキスト入力から呼ばれる。
 *
 * 一覧に無い名前は断る。datalist は入力を補助するだけで制限しないので、
 * 打ち間違えた名前がそのまま届く。ここで作ってしまうと、
 * backend と bakcend が並んだ時点で「組織で共通に使う」前提が壊れる。
 *
 * 大文字小文字は問わない。一意索引が lower(name) で張ってあるので、
 * 探す側だけが区別すると「あるのに無いと言われる」状態になる。
 */
export async function attachTagByName(
  scope: OrgScope,
  threadId: string,
  name: string,
): Promise<TagChange> {
  const trimmed = name.trim();
  if (trimmed === '') {
    return { ok: false, reason: 'invalid-name' };
  }

  return transaction(async (client) => {
    if (!(await writable(client, scope, threadId))) {
      return { ok: false, reason: 'thread-not-found' };
    }

    const found = await client.query<{ id: string }>(
      `SELECT id FROM tags
        WHERE organization_id = $1 AND deleted_at IS NULL AND lower(name) = lower($2)`,
      [scope.organizationId, trimmed],
    );
    const tag = found.rows[0];
    if (!tag) {
      return { ok: false, reason: 'no-such-tag' };
    }

    await attachTagsTo(client, scope.organizationId, threadId, [tag.id]);
    return { ok: true };
  });
}

/** 一つ外す。付いていなくても成功として返す。押した結果は同じである。 */
export async function detachTag(
  scope: OrgScope,
  threadId: string,
  tagId: string,
): Promise<TagChange> {
  return transaction(async (client) => {
    if (!(await writable(client, scope, threadId))) {
      return { ok: false, reason: 'thread-not-found' };
    }
    await client.query(`DELETE FROM thread_tags WHERE thread_id = $1 AND tag_id = $2`, [
      threadId,
      tagId,
    ]);
    return { ok: true };
  });
}

/**
 * 付いているタグを、渡された集合で置き換える。
 * チェックボックスの一覧から呼ばれる。
 *
 * 差分ではなく全体を受け取るのは、チェックボックスが
 * 「外したもの」を送ってこないためである。
 * 送られてこなかったものを外す、という読み方しかできない。
 */
export async function setThreadTags(
  scope: OrgScope,
  threadId: string,
  tagIds: readonly string[],
): Promise<TagChange> {
  return transaction(async (client) => {
    if (!(await writable(client, scope, threadId))) {
      return { ok: false, reason: 'thread-not-found' };
    }

    await client.query(
      `DELETE FROM thread_tags WHERE thread_id = $1 AND NOT (tag_id = ANY($2::uuid[]))`,
      [threadId, tagIds],
    );
    await attachTagsTo(client, scope.organizationId, threadId, tagIds);
    return { ok: true };
  });
}

/**
 * そのタグが付いているスレッドの数。消す前の歯止めに使う。
 *
 * listTagsForAdmin と同じ数え方でなければ意味がない。
 * 一覧に「3件」と出したあとで、押した先が「20件から外れます」と言い出すと、
 * どちらが本当なのか確かめる手立てが無くなる。
 */
export async function countTagUsage(scope: OrgScope, tagId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT count(*) AS count
       FROM thread_tags tt
       JOIN threads t ON t.id = tt.thread_id AND t.deleted_at IS NULL
       JOIN tags g    ON g.id = tt.tag_id
      WHERE tt.tag_id = $2 AND g.organization_id = $1 AND g.deleted_at IS NULL`,
    [scope.organizationId, tagId],
  );
  return Number(rows[0]?.count ?? 0);
}
