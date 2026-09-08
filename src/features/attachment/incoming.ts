import { BATCH_MAX, FILE_FIELD, FILE_MAX, FILENAME_MAX, formatBytes } from './limits.ts';

/* ==========================================================================
   届いたファイルを受け取る

   フォームから来た値を、保存できる形にするところまでを引き受ける。
   誰が書けるかの判定はここに無い。それは queries.ts の仕事である。
   ========================================================================== */

export type Incoming = {
  readonly filename: string;
  /** ブラウザが申告した種別。記録するだけで、配信には使わない */
  readonly declaredType: string | null;
  readonly bytes: Buffer;
};

export type IncomingProblem = 'too-large' | 'batch-too-large' | 'bad-name';

/** 受け取る側と作り直す側を合わせた、断る理由の全体 */
export type FileProblem = IncomingProblem | 'reencoded-too-large';

export type IncomingResult =
  | { ok: true; files: Incoming[] }
  | { ok: false; reason: IncomingProblem; filename: string };

/*
 * 名前から落とす文字。
 *
 * 制御文字は Content-Disposition と画面の両方に出る値なので落とす。
 * 双方向の制御文字（U+202E など）を残すと、`report<U+202E>gpj.exe` が
 * 画面上で `report.exe.jpg` に見える。拡張子を偽装する古い手口である。
 */
function harmless(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  if (code < 0x20 || code === 0x7f) {
    return false;
  }
  if (code >= 0x200e && code <= 0x200f) {
    return false;
  }
  if (code >= 0x202a && code <= 0x202e) {
    return false;
  }
  return !(code >= 0x2066 && code <= 0x2069);
}

/**
 * 表示用の名前を整える。整えようがなければ null を返す。
 *
 * 長すぎる名前は切り詰める。断らないのは、名前の長さが
 * 送り直せば直るものではないためである。拡張子だけは残す。
 */
export function cleanName(raw: string): string | null {
  // 区切りより後ろだけを使う。ブラウザによってはパスが付く
  const base = raw.split(/[\\/]/).pop() ?? '';
  const kept = [...base].filter(harmless).join('').trim();

  if (kept === '' || kept === '.' || kept === '..') {
    return null;
  }
  if (kept.length <= FILENAME_MAX) {
    return kept;
  }

  const dot = kept.lastIndexOf('.');
  // 拡張子だけで 20 文字を超えるものは、拡張子として扱わない
  const extension = dot > 0 && kept.length - dot <= 20 ? kept.slice(dot) : '';
  return kept.slice(0, FILENAME_MAX - extension.length) + extension;
}

/**
 * フォームからファイルを取り出す。
 *
 * 中身の無いものは、選ばれなかったものとして落とす。
 *
 * 何も選ばずに投稿しても、ファイルの欄は送られてくる。
 * そのとき届く形は一つではない。名前の無い File のこともあれば、
 * 名前を失って Blob になっていることもある。
 * Blob を FormData に入れると、仕様どおり blob という名前が付く
 * （https://xhr.spec.whatwg.org/#dom-formdata-append）。
 *
 * つまり「何も選んでいない」と「空のファイルを選んだ」は、
 * ここへ届いた時点では見分けられない。名前が残っていないためである。
 * 断るほうを選ぶと、添付を付けないコメントが一つも投稿できなくなる。
 *
 * 実際にそうなった。コメントを書くたびに
 * 「blob は中身が空です」と出て、投稿できなかった（2026-09-08 に本番で踏んだ）。
 *
 * 何も付かなかったことは、付ける側の画面が別に伝える。
 * スレッドへ添付する画面は「ファイルを選んでください」と返す。
 */
export async function readIncoming(form: FormData): Promise<IncomingResult> {
  const entries = form
    .getAll(FILE_FIELD)
    .filter((value): value is File => value instanceof File);
  const chosen = entries.filter((file) => file.size > 0);

  let total = 0;
  const files: Incoming[] = [];

  for (const file of chosen) {
    const name = cleanName(file.name);
    if (name === null) {
      return { ok: false, reason: 'bad-name', filename: file.name };
    }
    if (file.size > FILE_MAX) {
      return { ok: false, reason: 'too-large', filename: name };
    }

    total += file.size;
    if (total > BATCH_MAX) {
      return { ok: false, reason: 'batch-too-large', filename: name };
    }

    files.push({
      filename: name,
      declaredType: file.type === '' ? null : file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
  }

  return { ok: true, files };
}

/**
 * 断る理由を文にする。
 *
 * 付ける側の経路は二つある（本文とコメント）が、断る理由は同じである。
 * 二箇所に書くと、片方の文面だけが直った状態が起きる。
 */
export function describeProblem(reason: FileProblem, filename: string): string {
  switch (reason) {
    case 'too-large':
      return `${filename} が ${formatBytes(FILE_MAX)} を超えています`;
    case 'batch-too-large':
      return `一度に送れるのは合計 ${formatBytes(BATCH_MAX)} までです。何回かに分けてください`;
    case 'bad-name':
      return 'ファイル名が扱えません';
    case 'reencoded-too-large':
      // 透明を持つ画像は PNG で書き出すため、元より大きくなることがある
      return `${filename} は作り直すと ${formatBytes(FILE_MAX)} を超えます`;
  }
}
