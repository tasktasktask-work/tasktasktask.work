import type { PoolClient } from 'pg';

/* ==========================================================================
   スレッドへの結び付け

   queries.ts から切り出してある。スレッドを立てるときにも同じ処理が要り、
   そちらは threads の挿入と同じ取引の中で走らせたいためである。

   queries.ts は書き込みの可否を #features/thread/queries.ts の
   threadWritable() で判定する。その判定を持ったまま
   #features/thread/queries.ts から呼ぶと、二つの模組が互いを参照する。
   ここには判定を置かない。呼ぶ側が先に済ませている前提の、
   行を入れるだけの関数である。
   ========================================================================== */

/**
 * 指定した id のタグを結び付ける。
 *
 * 既に付いているものは何もしない（ON CONFLICT DO NOTHING）。
 * 二つの画面から同時に同じタグを付けても、片方が主キー違反で落ちない。
 *
 * 組織の外の id と、消えたタグの id は SELECT の側で落ちる。
 * WHERE で弾いているのではなく、入れる行がそもそも作られない。
 * 「他組織のタグ id を差し込む」形の攻撃は、ここで空振りになる。
 */
export async function attachTagsTo(
  client: PoolClient,
  organizationId: string,
  threadId: string,
  tagIds: readonly string[],
): Promise<void> {
  if (tagIds.length === 0) {
    return;
  }
  await client.query(
    `INSERT INTO thread_tags (thread_id, tag_id)
     SELECT $2, g.id
       FROM tags g
      WHERE g.organization_id = $1
        AND g.deleted_at IS NULL
        AND g.id = ANY($3::uuid[])
     ON CONFLICT DO NOTHING`,
    [organizationId, threadId, tagIds],
  );
}
