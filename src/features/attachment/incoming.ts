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

export type IncomingProblem = 'too-large' | 'batch-too-large' | 'empty-file' | 'bad-name';

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
 * 空のファイル欄は File として届き、大きさが 0 になる。
 * これを弾くと「何も選ばずに投稿する」が通らなくなるので、先に落とす。
 */
export async function readIncoming(form: FormData): Promise<IncomingResult> {
  const entries = form
    .getAll(FILE_FIELD)
    .filter((value): value is File => value instanceof File);
  const chosen = entries.filter((file) => file.size > 0 || file.name !== '');

  let total = 0;
  const files: Incoming[] = [];

  for (const file of chosen) {
    const name = cleanName(file.name);
    if (name === null) {
      return { ok: false, reason: 'bad-name', filename: file.name };
    }
    if (file.size === 0) {
      return { ok: false, reason: 'empty-file', filename: name };
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
    case 'empty-file':
      return `${filename} は中身が空です`;
    case 'bad-name':
      return 'ファイル名が扱えません';
    case 'reencoded-too-large':
      // 透明を持つ画像は PNG で書き出すため、元より大きくなることがある
      return `${filename} は作り直すと ${formatBytes(FILE_MAX)} を超えます`;
  }
}
