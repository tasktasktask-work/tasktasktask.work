import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { env } from '#lib/env.ts';

/* ==========================================================================
   実体の置き場

   データベースが持つのは在り処だけで、中身はここにある。
   バックアップを取るときは、この下とデータベースを同じ時点で揃える。
   片方だけ戻しても、名前だけの添付か、誰にも見えないファイルが残る。

   置き場所を差し替えられるように、パスを組み立てるのはこのファイルだけに
   閉じてある。オブジェクトストレージへ移すときに書き換えるのはここである。
   ========================================================================== */

/** ATTACHMENTS_DIR の実体パス。設定を読むのは最初に触られたときだけである */
function root(): string {
  return resolve(env.ATTACHMENTS_DIR);
}

/**
 * 保存先のキーを作る。
 *
 * 利用者の入力を一文字も含まない。
 * 名前をそのままパスに使うと、`../../` によるパストラバーサルと、
 * 右横書きの制御文字による拡張子の偽装が入口になる。
 *
 * 組織で一段掘るのは、容量を組織ごとに数えられるようにするためと、
 * 組織を消すときの片付けを一箇所で済ませるためである。
 * さらに二文字で掘るのは、一つのディレクトリに数万件を並べると
 * 走査が効かなくなるためで、uuid の頭は十分に散らばる。
 *
 * 拡張子は再エンコードした画像にだけ付く。
 * 配信のときの Content-Type はこの拡張子から決める。
 * 表示用の名前から決めると、利用者由来の値がヘッダに回り込む。
 */
export function newKey(organizationId: string, extension: string | null): string {
  const id = randomUUID();
  const fan = id.slice(0, 2);
  return `${organizationId}/${fan}/${id}${extension === null ? '' : `.${extension}`}`;
}

/**
 * キーを実体のパスに直す。
 *
 * キーは生成した値なので本来この検査は要らない。
 * それでも確かめるのは、この関数がデータベースから来た文字列を
 * ファイルシステムへ渡す唯一の場所だからである。
 */
function pathFor(key: string): string {
  const base = root();
  const full = resolve(join(base, key));
  if (full !== base && !full.startsWith(base + sep)) {
    throw new Error(`保存先のキーが置き場の外を指しています: ${key}`);
  }
  return full;
}

export async function write(key: string, bytes: Buffer): Promise<void> {
  const full = pathFor(key);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, bytes, { flag: 'wx' });
}

export async function read(key: string): Promise<Buffer> {
  return readFile(pathFor(key));
}

/**
 * 実体を消す。
 *
 * 既に無いときは黙って戻る。
 * 呼ばれるのは行を落とした後なので、ここで落ちても直せることが無い。
 */
export async function remove(key: string): Promise<void> {
  try {
    await unlink(pathFor(key));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}
