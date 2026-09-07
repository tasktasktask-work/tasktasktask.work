'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import type { Candidate } from '#lib/markdown.ts';
import { type CommentActionState, postCommentAction } from './actions.ts';

/* ==========================================================================
   コメントを書く欄

   @ を打つと候補が出る。表示名には空白が入るので、打ち切るのは骨が折れる。
   選べば、あとは投稿時の最長一致がそのまま拾う。

   候補に出るのは、そのプロジェクトを閲覧できる人だけである。
   ここに出ない人を指名しても、通知は飛ばない。
   ========================================================================== */

const empty: CommentActionState = {};

/** @ の直後から入力位置までを取り出す。ここが候補の絞り込みに使う文字列になる */
function tokenAt(value: string, caret: number): { at: number; text: string } | null {
  for (let i = caret - 1; i >= 0; i--) {
    const ch = value[i];
    if (ch === '\n') {
      return null;
    }
    if (ch === '@') {
      const before = i > 0 ? (value[i - 1] ?? '') : '';
      // メールアドレスの途中を指名と読まない
      return /[0-9A-Za-z_@]/.test(before) ? null : { at: i, text: value.slice(i + 1, caret) };
    }
    // 名前より長くなったら、もう指名を打っているところではない
    if (caret - i > 24) {
      return null;
    }
  }
  return null;
}

function narrow(candidates: readonly Candidate[], text: string): Candidate[] {
  if (text === '') {
    return candidates.slice(0, 8);
  }
  const needle = text.toLowerCase();
  const hit = candidates.filter((c) => c.displayName.toLowerCase().includes(needle));
  // 頭から一致するものを先に出す
  hit.sort((a, b) => {
    const ax = a.displayName.toLowerCase().startsWith(needle) ? 0 : 1;
    const bx = b.displayName.toLowerCase().startsWith(needle) ? 0 : 1;
    return ax - bx;
  });
  return hit.slice(0, 8);
}

export function CommentForm({
  target,
  candidates,
}: {
  target: { slug: string; projectKey: string; number: number };
  candidates: readonly Candidate[];
}) {
  const [state, action, sending] = useActionState(postCommentAction, empty);
  const box = useRef<HTMLTextAreaElement>(null);
  const [menu, setMenu] = useState<{ at: number; items: Candidate[]; index: number } | null>(
    null,
  );

  // 投稿できたら空にする。state は毎回新しい入れ物で来るので、続けて投稿しても効く
  useEffect(() => {
    if (state.notice && box.current) {
      box.current.value = '';
    }
  }, [state]);

  const rethink = () => {
    const area = box.current;
    if (!area) {
      return;
    }
    const token = tokenAt(area.value, area.selectionStart);
    if (!token) {
      setMenu(null);
      return;
    }
    const items = narrow(candidates, token.text);
    setMenu(items.length === 0 ? null : { at: token.at, items, index: 0 });
  };

  const insert = (name: string) => {
    const area = box.current;
    if (!area || !menu) {
      return;
    }
    const value = area.value;
    const after = value.slice(area.selectionStart);
    const head = `${value.slice(0, menu.at)}@${name}`;
    const gap = after.startsWith(' ') || after.startsWith('\n') ? '' : ' ';

    area.value = head + gap + after;
    const caret = head.length + gap.length;
    area.setSelectionRange(caret, caret);
    area.focus();
    setMenu(null);
  };

  return (
    <div className="app-compose">
      <form action={action}>
        <input type="hidden" name="slug" value={target.slug} />
        <input type="hidden" name="key" value={target.projectKey} />
        <input type="hidden" name="number" value={target.number} />

        {state.error ? <div className="app-note warn">{state.error}</div> : null}

        <textarea
          ref={box}
          name="body"
          required
          placeholder="コメントを書く（Markdown が使えます。@ で人を指名できます）"
          onInput={rethink}
          onClick={rethink}
          onBlur={() => setTimeout(() => setMenu(null), 120)}
          onKeyDown={(event) => {
            if (!menu) {
              return;
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const step = event.key === 'ArrowDown' ? 1 : menu.items.length - 1;
              setMenu({ ...menu, index: (menu.index + step) % menu.items.length });
              return;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
              const picked = menu.items[menu.index];
              if (picked) {
                event.preventDefault();
                insert(picked.displayName);
              }
              return;
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              setMenu(null);
            }
          }}
        />

        <div className="foot">
          <button className="app-btn" type="submit" disabled={sending}>
            {sending ? '投稿中…' : '投稿する'}
          </button>
          <span style={{ flex: 1 }} />
          <span className="warn-inline">⚠ 投稿したコメントは編集も削除もできません</span>
        </div>
      </form>

      {menu ? (
        <div className="app-mentions" role="listbox" aria-label="指名の候補">
          {menu.items.map((item, i) => (
            <button
              type="button"
              role="option"
              key={item.userId}
              aria-selected={i === menu.index}
              onMouseDown={(event) => {
                // blur より先に拾う。blur が走ると候補が閉じてしまう
                event.preventDefault();
                insert(item.displayName);
              }}
            >
              {item.displayName}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
