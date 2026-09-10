import type { PoolClient } from 'pg';
import { reencode, withExtension } from './image.ts';
import type { Incoming } from './incoming.ts';
import { FILE_MAX } from './limits.ts';
import { newKey, remove, write } from './storage.ts';

/* ==========================================================================
   行と実体を書く

   queries.ts から切り出してある。コメントを投稿するときにも同じ処理が要り、
   そちらは comments の挿入と同じ取引の中で走らせたいためである。

   queries.ts は書き込みの可否を #features/thread/queries.ts の
   threadWritable() で判定する。その判定を持ったまま
   #features/comment/queries.ts から呼ぶと、二つの模組が互いを参照する。
   ここには判定を置かない。呼ぶ側が先に済ませている前提の関数である。

   処理は二段に分かれている。
   作り直すのが prepare、書くのが store である。
   分けたのは、10MB の画像を読み直して書き出すのに数秒かかるからで、
   これを取引の中でやると、その数秒ぶん行を押さえたままになる。
   ========================================================================== */

export type Owner = { readonly threadId: string } | { readonly commentId: string };

export type Prepared = {
  readonly filename: string;
  readonly declaredType: string | null;
  readonly bytes: Buffer;
  readonly key: string;
  readonly isImage: boolean;
};

export type PrepareResult =
  | { ok: true; prepared: Prepared[] }
  | { ok: false; reason: 'reencoded-too-large'; filename: string };

/**
 * 保存する形まで作る。データベースには触らない。
 *
 * 透明を持つ画像を PNG で書き出すと、元より大きくなることがある。
 * 上限を超えたものはここで断る。原本を代わりに置く手もあるが、
 * それをやると「作り直した出力だけを保存する」という約束が、
 * 大きい画像のときだけ黙って外れる。
 */
export async function prepareAttachments(
  organizationId: string,
  files: readonly Incoming[],
): Promise<PrepareResult> {
  const prepared: Prepared[] = [];

  for (const file of files) {
    const image = await reencode(file.bytes);
    const bytes = image === null ? file.bytes : image.bytes;

    if (bytes.byteLength > FILE_MAX) {
      return { ok: false, reason: 'reencoded-too-large', filename: file.filename };
    }

    prepared.push({
      filename: image === null ? file.filename : withExtension(file.filename, image.extension),
      declaredType: file.declaredType,
      bytes,
      key: newKey(organizationId, image === null ? null : image.extension),
      isImage: image !== null,
    });
  }

  return { ok: true, prepared };
}

/**
 * 行を入れ、実体を書く。呼び出し側の取引の中で走る。
 *
 * データベースとファイルシステムは同じ取引に入らないので、どちらかが先になる。
 * 行を先に入れる形にしてあるのは、実体を先に書くと、
 * 行を入れる側が落ちたときに消す処理まで届かないためである。
 *
 * それでも「書けたがコミットで落ちた」窓は残る。
 * そこに残るのは、誰にも見えず容量だけ食うファイルである。
 * 掃除の仕組みは持たない（docs/issues/attachment-orphans/）。
 */
export async function storeAttachments(
  client: PoolClient,
  organizationId: string,
  uploadedByUserId: string,
  owner: Owner,
  prepared: readonly Prepared[],
): Promise<void> {
  if (prepared.length === 0) {
    return;
  }

  const written: string[] = [];
  try {
    for (const file of prepared) {
      /*
       * created_at を明示するのは、既定の now() が取引の開始時刻を返すためである。
       * 一度の送信で三枚入れると、三行とも同じ時刻になる。
       * そうなると並びは第二の鍵（ランダムな id）で決まり、
       * 選んだ順とは無関係になる。本文に「上の画像が」と書けなくなる。
       */
      await client.query(
        `INSERT INTO attachments
           (organization_id, thread_id, comment_id, storage_key,
            original_filename, byte_size, declared_type, is_image, uploaded_by_user_id,
            created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, clock_timestamp())`,
        [
          organizationId,
          'threadId' in owner ? owner.threadId : null,
          'commentId' in owner ? owner.commentId : null,
          file.key,
          file.filename,
          file.bytes.byteLength,
          file.declaredType,
          file.isImage,
          uploadedByUserId,
        ],
      );

      await write(file.key, file.bytes);
      written.push(file.key);
    }
  } catch (error) {
    // 行は呼び出し側の取引が巻き戻す。実体はここで消す
    await Promise.all(written.map((key) => remove(key).catch(() => undefined)));
    throw error;
  }
}
