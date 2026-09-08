import { z } from 'zod';
import { THREAD_WRITABLE } from '#features/thread/queries.ts';
import {
  type OrgScope,
  orgAdminExists,
  pool,
  transaction,
  VISIBLE_PROJECT_IDS,
} from '#lib/db.ts';
import { bigintColumn, many, one } from '#lib/row.ts';
import { remove } from './storage.ts';
import type { Prepared } from './store.ts';
import { storeAttachments } from './store.ts';

/* ==========================================================================
   添付ファイル

   スレッドかコメントのどちらか一方に付く。
   このテーブルが持つのは在り処と表示用の名前で、中身は storage.ts の側にある。

   仕様は docs/features/attachment/index.html にある。
   形式を検査しない理由と、配信の仕方で守る理由はそちらに書いてある。
   ========================================================================== */

export type AttachmentProblem =
  | 'forbidden'
  | 'not-found'
  | 'archived'
  | 'project-archived'
  | 'nothing-chosen';

export type AttachmentChange = { ok: true } | { ok: false; reason: AttachmentProblem };

/*
 * 添付の持ち主のスレッド。
 *
 * コメントに付いたものは、そのコメントのスレッドを指す。
 * 消されたコメントの添付は、ここで NULL になって誰にも当たらなくなる。
 * コメントが見えないのに添付だけ届く経路を作らないためである。
 */
const OWNER_THREAD = `COALESCE(a.thread_id,
             (SELECT c.thread_id FROM comments c
               WHERE c.id = a.comment_id AND c.deleted_at IS NULL))`;

/*
 * 読める添付の条件。
 *
 * 閲覧の判定はスレッドと同じ線である。プロジェクトが見える人は添付も読める。
 * 判定そのものは VISIBLE_PROJECT_IDS にあり、ここには書き写さない。
 */
const ATTACHMENT_VISIBLE = `a.organization_id = $1
        AND a.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM threads t
                     WHERE t.id = ${OWNER_THREAD}
                       AND t.organization_id = $1
                       AND t.deleted_at IS NULL
                       AND t.project_id IN (${VISIBLE_PROJECT_IDS}))`;

const attachmentRow = z.object({
  id: z.uuid(),
  filename: z.string(),
  byteSize: bigintColumn,
  isImage: z.boolean(),
  uploadedByUserId: z.uuid(),
  uploadedByName: z.string(),
  createdAt: z.date(),
});

export type AttachmentRow = z.infer<typeof attachmentRow>;

const columns = `a.id,
            a.original_filename   AS "filename",
            a.byte_size           AS "byteSize",
            a.is_image            AS "isImage",
            a.uploaded_by_user_id AS "uploadedByUserId",
            u.display_name        AS "uploadedByName",
            a.created_at          AS "createdAt"`;

/* --------------------------------------------------------------------------
   読む
   -------------------------------------------------------------------------- */

/** スレッドの本文に付いた添付。付けた順に返す */
export async function listThreadAttachments(
  scope: OrgScope,
  threadId: string,
): Promise<AttachmentRow[]> {
  const result = await pool.query(
    `SELECT ${columns}
       FROM attachments a
       JOIN users u ON u.id = a.uploaded_by_user_id
      WHERE a.thread_id = $3
        AND ${ATTACHMENT_VISIBLE}
      ORDER BY a.created_at, a.id`,
    [scope.organizationId, scope.userId, threadId],
  );
  return many(attachmentRow, result, 'listThreadAttachments');
}

const commentAttachmentRow = attachmentRow.extend({ commentId: z.uuid() });

/**
 * スレッドの中の、コメントに付いた添付をまとめて返す。
 *
 * コメントの数だけ問い合わせを投げない。
 * 一つのスレッドに数十のコメントが並ぶので、そこで往復すると
 * 画面を開くたびに数十回のやりとりが起きる。
 */
export async function listCommentAttachments(
  scope: OrgScope,
  threadId: string,
): Promise<Map<string, AttachmentRow[]>> {
  const result = await pool.query(
    `SELECT ${columns}, a.comment_id AS "commentId"
       FROM attachments a
       JOIN users u ON u.id = a.uploaded_by_user_id
       JOIN comments c ON c.id = a.comment_id
      WHERE c.thread_id = $3
        AND ${ATTACHMENT_VISIBLE}
      ORDER BY a.created_at, a.id`,
    [scope.organizationId, scope.userId, threadId],
  );

  const grouped = new Map<string, AttachmentRow[]>();
  for (const row of many(commentAttachmentRow, result, 'listCommentAttachments')) {
    const { commentId, ...attachment } = row;
    const list = grouped.get(commentId);
    if (list) {
      list.push(attachment);
    } else {
      grouped.set(commentId, [attachment]);
    }
  }
  return grouped;
}

const deliverable = z.object({
  storageKey: z.string(),
  filename: z.string(),
  isImage: z.boolean(),
});

export type Deliverable = z.infer<typeof deliverable>;

/**
 * 配信のために一件だけ引く。
 *
 * 返す経路は一本だけである（src/app/o/[slug]/a/[id]/route.ts）。
 * この関数を他から呼ぶと、ヘッダを付けない配信路が増える。
 */
export async function findDeliverable(
  scope: OrgScope,
  attachmentId: string,
): Promise<Deliverable | null> {
  const result = await pool.query(
    `SELECT a.storage_key       AS "storageKey",
            a.original_filename AS "filename",
            a.is_image          AS "isImage"
       FROM attachments a
      WHERE a.id = $3
        AND ${ATTACHMENT_VISIBLE}`,
    [scope.organizationId, scope.userId, attachmentId],
  );
  return one(deliverable, result, 'findDeliverable');
}

/* --------------------------------------------------------------------------
   書く
   -------------------------------------------------------------------------- */

/**
 * スレッドの本文に添付を付ける。
 *
 * 付けられるのは本文を書き換えられる人と同じ範囲である。
 * 本文そのものを書き換えられる相手に、添付だけ禁じても守るものが無い。
 */
export async function attachToThread(
  scope: OrgScope,
  threadId: string,
  prepared: readonly Prepared[],
): Promise<AttachmentChange> {
  if (prepared.length === 0) {
    return { ok: false, reason: 'nothing-chosen' };
  }

  return transaction(async (client) => {
    const { rowCount } = await client.query(
      `SELECT 1 FROM threads t WHERE t.id = $3 AND ${THREAD_WRITABLE}`,
      [scope.organizationId, scope.userId, threadId],
    );
    if (rowCount !== 1) {
      return { ok: false, reason: await whyNot(scope, threadId) };
    }

    await storeAttachments(client, scope.organizationId, scope.userId, { threadId }, prepared);
    return { ok: true };
  });
}

/**
 * 添付を消す。行は残し、実体を消す。
 *
 * 消せるのは上げた本人と組織管理者である。
 * 畳んだスレッドでは消せない。書き込みを一律で止める線に揃えてある。
 * 畳んだ後に消したくなったら、畳みを解いて、消して、畳み直すことになる。
 *
 * 実体を消すのはコミットの後である。
 * 先に消すと、コミットに失敗したときに「生きている行の実体が無い」状態が残る。
 * 順を逆にして残るのは「消えたことになっている行の実体」で、
 * こちらは誰にも届かず、容量だけを食う。軽いほうを選んである。
 */
export async function deleteAttachment(
  scope: OrgScope,
  attachmentId: string,
): Promise<AttachmentChange> {
  const result = await pool.query<{ storageKey: string }>(
    `UPDATE attachments a
        SET deleted_at = now(), deleted_by_user_id = $2
      WHERE a.id = $3
        AND a.organization_id = $1
        AND a.deleted_at IS NULL
        AND (a.uploaded_by_user_id = $2 OR ${orgAdminExists('$1', '$2')})
        AND EXISTS (SELECT 1 FROM threads t
                     WHERE t.id = ${OWNER_THREAD}
                       AND ${THREAD_WRITABLE})
    RETURNING a.storage_key AS "storageKey"`,
    [scope.organizationId, scope.userId, attachmentId],
  );

  const key = result.rows[0]?.storageKey;
  if (key === undefined) {
    return { ok: false, reason: 'forbidden' };
  }

  await remove(key);
  return { ok: true };
}

/* --------------------------------------------------------------------------
   容量
   -------------------------------------------------------------------------- */

const usage = z.object({ bytes: bigintColumn, count: z.number().int() });

export type Usage = z.infer<typeof usage>;

/**
 * 組織が使っている容量。組織管理者だけが見る。
 *
 * 上限は持たない。数えるのは、埋まりかけたことに気づくためである。
 * ディスクの監視は「もう危ない」ことしか教えず、
 * どの組織が食っているかは、そのとき調べ直すことになる。
 */
export async function organizationUsage(scope: OrgScope): Promise<Usage | null> {
  if (!scope.isOrgAdmin) {
    return null;
  }
  const result = await pool.query(
    `SELECT COALESCE(SUM(byte_size), 0)::text AS bytes,
            count(*)::int                     AS count
       FROM attachments
      WHERE organization_id = $1 AND deleted_at IS NULL`,
    [scope.organizationId],
  );
  return one(usage, result, 'organizationUsage');
}

/* --------------------------------------------------------------------------
   断る理由
   -------------------------------------------------------------------------- */

/**
 * 書けなかった理由を、書ける条件を一つずつ緩めて突き止める。
 *
 * 「見つかりません」で済ませると、畳んだだけのスレッドに
 * 書こうとした人が、消えたのだと思って探しに行く。
 */
async function whyNot(scope: OrgScope, threadId: string): Promise<AttachmentProblem> {
  const { rows } = await pool.query<{ archived: boolean; projectArchived: boolean }>(
    `SELECT (t.archived_at IS NOT NULL) AS archived,
            (p.archived_at IS NOT NULL) AS "projectArchived"
       FROM threads t
       JOIN projects p ON p.id = t.project_id
      WHERE t.id = $3
        AND t.organization_id = $1
        AND t.deleted_at IS NULL
        AND t.project_id IN (${VISIBLE_PROJECT_IDS})`,
    [scope.organizationId, scope.userId, threadId],
  );

  const row = rows[0];
  if (!row) {
    return 'not-found';
  }
  return row.projectArchived ? 'project-archived' : row.archived ? 'archived' : 'forbidden';
}
