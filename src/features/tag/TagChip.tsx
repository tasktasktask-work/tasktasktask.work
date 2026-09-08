import type { CSSProperties, ReactNode } from 'react';
import { ROW_TAG_LIMIT, TAG_COLOR_LABELS } from './colors.ts';

/*
 * タグの札。
 *
 * 色は円形の小さな点で示し、文字色は変えない。
 * タグが増えても文字の可読性が落ちず、色覚の違いによる読み取りの差も出ない。
 * 点を描くのは CSS 側（.p-tag::before）で、色だけをここから渡す。
 */

/** カスタムプロパティは CSSProperties に無い。ここだけで型を緩める。 */
function tint(color: string): CSSProperties {
  return { '--tag-color': color } as CSSProperties;
}

export function TagChip({
  name,
  color,
  children,
}: {
  name: string;
  color: string;
  /** 札の中に置くもの。外す押しボタンだけが使う。 */
  children?: ReactNode;
}) {
  return (
    <span className="p-tag" style={tint(color)}>
      {name}
      {children}
    </span>
  );
}

/**
 * 色見本。丸をそのまま押させる。
 *
 * select に色名を並べる案もあったが、選ぶ前に色が見えない。
 * 「浅葱」がどの色かを覚えている人だけが選べる欄になる。
 */
export function ColorSwatches({
  colors,
  name,
  selected,
}: {
  colors: readonly string[];
  name: string;
  selected: string;
}) {
  return (
    <span className="p-swatches">
      {colors.map((color) => (
        <label className="p-swatch" key={color} style={tint(color)}>
          <input
            type="radio"
            name={name}
            value={color}
            defaultChecked={color === selected}
            aria-label={TAG_COLOR_LABELS[color] ?? color}
          />
          <span aria-hidden="true" />
        </label>
      ))}
    </span>
  );
}

/**
 * 行に並べるタグ。三つまでで、あとは数だけ出す。
 *
 * 全部並べると、タグの多いスレッドの行だけが折り返して高さが変わる。
 * 一覧は上から下へ目を滑らせる場所なので、行の高さが揃っていないと
 * 数えるほうに注意が持っていかれる。
 */
export function TagList({ tags }: { tags: readonly { name: string; color: string }[] }) {
  const shown = tags.slice(0, ROW_TAG_LIMIT);
  const rest = tags.length - shown.length;

  return (
    <>
      {shown.map((tag) => (
        <TagChip key={tag.name} name={tag.name} color={tag.color} />
      ))}
      {rest > 0 ? <span className="p-tag-more">+{rest}</span> : null}
    </>
  );
}
