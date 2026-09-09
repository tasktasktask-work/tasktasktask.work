/* ==========================================================================
   ブラウザ側で写真を縮める

   ファイルを選ぶ欄と、落として添付する欄の両方から呼ぶ。
   書き写すと、片方だけが PNG を触る、といった食い違いが起きる。
   ========================================================================== */

import { BATCH_MAX, FILE_MAX, formatBytes } from './limits.ts';

/**
 * 大きすぎる写真を、品質だけ落として上限に収める。
 *
 * 触るのは上限を超えた画像だけである。常に縮めると、
 * 1MB の写真も劣化させて、得るのは上りの数百ミリ秒になる。
 *
 * 長辺は縮めない。サーバー側で縮めないと決めたのと同じ理由で、
 * ここで縮めると、その一枚は二度と原寸に戻らない。
 * PNG は触らない。スクリーンショットの文字が潰れると添付の用をなさなくなる。
 *
 * ライブラリは選んだときだけ読み込む。
 * 添付を使わない人の画面に、この重さを持ち込まない。
 */
export async function shrink(file: File): Promise<File> {
  if (file.size <= FILE_MAX || !file.type.startsWith('image/') || file.type === 'image/png') {
    return file;
  }

  const { default: compress } = await import('browser-image-compression');
  try {
    return await compress(file, {
      maxSizeMB: FILE_MAX / (1024 * 1024),
      // 長辺は変えない。既定では 1920px に縮められる
      maxWidthOrHeight: Number.MAX_SAFE_INTEGER,
      useWebWorker: true,
      // Exif の向きを画素へ畳み込む。横倒しのまま送らないため
      preserveExif: false,
    });
  } catch {
    // 読めなかったものは、そのままサーバーへ送って断らせる
    return file;
  }
}

/**
 * 縮めたあとの大きさを見る。収まらなければ断る文を返す。
 *
 * 一つでも超えていたら、その回の全部を断る。
 * 大きいものだけ落として残りを送ると、何が上がって何が上がらなかったかを
 * 人が突き合わせることになる。
 */
export function tooLarge(files: readonly File[]): string | null {
  const big = files.find((file) => file.size > FILE_MAX);
  if (big) {
    return `${big.name} は ${formatBytes(FILE_MAX)} に収まりません`;
  }
  if (files.reduce((sum, file) => sum + file.size, 0) > BATCH_MAX) {
    return `一度に送れるのは合計 ${formatBytes(BATCH_MAX)} までです`;
  }
  return null;
}

/** 縮めた結果を欄へ戻す。ここを通ったものが、そのまま送られる。 */
export function putBack(input: HTMLInputElement, files: readonly File[]): void {
  const box = new DataTransfer();
  for (const file of files) {
    box.items.add(file);
  }
  input.files = box.files;
}
