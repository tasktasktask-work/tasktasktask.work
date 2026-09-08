/* ==========================================================================
   添付の寸法

   画面の側（'use client'）からも読む値をここに置く。
   queries.ts に置くと、そこから pg がブラウザ向けの束に入る。
   ========================================================================== */

/** 1ファイルの上限。attachments_size_limit と同じ値である */
export const FILE_MAX = 10 * 1024 * 1024;

/**
 * 一度の送信で送れる合計。
 *
 * サーバーアクションは本体を丸ごとメモリに載せるので、
 * これがそのまま同時アップロード1件あたりの消費になる。
 * next.config.ts の bodySizeLimit は、この値に余白を足したものである。
 */
export const BATCH_MAX = 30 * 1024 * 1024;

/** 表示用の名前の長さ。attachments_filename_length と同じ値である */
export const FILENAME_MAX = 255;

/** ファイルを選ぶ欄と、送るフォームで使う名前 */
export const FILE_FIELD = 'files';

/** 人が読む大きさ。切り上げないので、10MB ちょうどが 10.0 MB と出る */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
