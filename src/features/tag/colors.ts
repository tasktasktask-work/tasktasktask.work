/* ==========================================================================
   タグの色

   queries.ts から切り離してある。色見本は画面の側（クライアント）でも要り、
   queries.ts を読むと pg ごとブラウザ向けの束に入ってしまうためである。
   ========================================================================== */

/**
 * 色見本。ここに無い色は保存しない。
 *
 * スキーマの CHECK は `^#[0-9a-f]{6}$` しか見ないので、
 * 背景に沈んで見えない色も通る。色は円形の小さな点でしか出ないため、
 * 薄い色を選ばれると点が消えたのと同じ見え方になる。
 *
 * theme.css が既に持っている五色に、同じ調子の三色を足したものである。
 */
export const TAG_COLORS = [
  '#c8402c',
  '#2c4a75',
  '#3f6b52',
  '#8f6410',
  '#6b4a7d',
  '#7a5a3c',
  '#2c6f75',
  '#7d8792',
] as const;

/** 読み上げと押しボタンの名札に使う。色の丸だけでは、押す先を伝えられない。 */
export const TAG_COLOR_LABELS: Record<string, string> = {
  '#c8402c': '朱',
  '#2c4a75': '藍',
  '#3f6b52': '緑',
  '#8f6410': '黄',
  '#6b4a7d': '紫',
  '#7a5a3c': '茶',
  '#2c6f75': '浅葱',
  '#7d8792': '灰',
};

export const DEFAULT_TAG_COLOR = TAG_COLORS[7];

export type TagColor = (typeof TAG_COLORS)[number];

export function isTagColor(value: string): value is TagColor {
  return (TAG_COLORS as readonly string[]).includes(value);
}

/** tags_name_not_blank が許す長さ。画面の maxLength と検証で同じ値を使う。 */
export const NAME_MAX = 40;

/** 一覧の行に並べるタグの数。これを超えたぶんは数だけ出す。 */
export const ROW_TAG_LIMIT = 3;
