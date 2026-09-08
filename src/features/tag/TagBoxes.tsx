import Link from 'next/link';
import { tagsPath } from './path.ts';
import type { TagRow } from './queries.ts';
import { TagChip } from './TagChip.tsx';

/*
 * スレッドを立てるフォームに置くタグの欄。
 *
 * ここにはテキスト入力を置かない。立てる前なので「一つ足す」という操作が
 * 存在せず、送るのは常に選んだ全体だからである。
 * 押しボタンも持たない。フォームの保存に相乗りする。
 */
export function TagBoxes({ slug, all }: { slug: string; all: TagRow[] }) {
  if (all.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: '.8rem', color: 'var(--ink-soft)' }}>
        タグがまだありません。<Link href={tagsPath(slug)}>タグを作る</Link>
      </p>
    );
  }

  return (
    <span className="p-tag-pick">
      <details>
        <summary>一覧から選ぶ</summary>
        <span className="boxes">
          {all.map((tag) => (
            <label key={tag.id}>
              <input type="checkbox" name="tags" value={tag.id} />
              <TagChip name={tag.name} color={tag.color} />
            </label>
          ))}
        </span>
      </details>
    </span>
  );
}
