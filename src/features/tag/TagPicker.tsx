'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import {
  attachTagAction,
  detachTagAction,
  setThreadTagsAction,
  type TagActionState,
} from './actions.ts';
import { tagsPath } from './path.ts';
import type { TagRow } from './queries.ts';
import { TagChip } from './TagChip.tsx';

/*
 * スレッド詳細の属性欄で、タグを付け外しする。
 *
 * 入り口が三つある。付いている札の × で外す、名前を打って足す、
 * 畳んだ一覧をチェックで入れ替える。
 *
 * 打つ側を主にしてあるのは、組織の単位で誰でも作れる決まりのため、
 * タグが数十個まで増えうるからである。
 * その数のチェックボックスを常に開いておくと、属性欄が縦に伸びて
 * 進捗率も期間も画面の外へ出る。
 */

const empty: TagActionState = {};

export type Target = { slug: string; projectKey: string; number: number };

function hidden({ slug, projectKey, number }: Target) {
  return (
    <>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="key" value={projectKey} />
      <input type="hidden" name="number" value={number} />
    </>
  );
}

export function TagPicker({
  target,
  attached,
  all,
}: {
  target: Target;
  attached: TagRow[];
  /** 組織のタグすべて。絞り込みと違い、使われていないものも出す */
  all: TagRow[];
}) {
  const [addState, add, adding] = useActionState(attachTagAction, empty);
  const [dropState, drop] = useActionState(detachTagAction, empty);
  const [setState, replace, saving] = useActionState(setThreadTagsAction, empty);

  if (all.length === 0) {
    // 空の入力欄と空の三角を並べても、開いた先に何も無い。
    return (
      <span className="p-tag-pick">
        <span style={{ fontSize: '.8rem', color: 'var(--ink-soft)' }}>
          タグがまだありません。
          <Link href={tagsPath(target.slug)}>タグを作る</Link>
        </span>
      </span>
    );
  }

  const on = new Set(attached.map((tag) => tag.id));

  return (
    <span className="p-tag-pick">
      {/*
       * 一つ外すためだけに、下の一覧を開かせない。
       *
       * 札ごとにフォームを作らず、どのタグを外すかは押しボタン自身の
       * name と value が運ぶ。送信した押しボタンの値だけが FormData に入る。
       */}
      {attached.length > 0 ? (
        <form className="on" action={drop}>
          {hidden(target)}
          {attached.map((tag) => (
            <TagChip key={tag.id} name={tag.name} color={tag.color}>
              <button
                type="submit"
                name="tagId"
                value={tag.id}
                aria-label={`${tag.name} を外す`}
              >
                ×
              </button>
            </TagChip>
          ))}
        </form>
      ) : null}

      <form action={add}>
        {hidden(target)}
        <input
          type="text"
          name="name"
          list="tag-names"
          placeholder="タグの名前"
          aria-label="タグを名前で足す"
          style={{ width: '9rem' }}
        />
        {/*
         * datalist は補助であって制限ではない。一覧に無い名前も送れる。
         * 作るのは管理画面だけと決めてあるので、届いた側で断る。
         */}
        <datalist id="tag-names">
          {all.map((tag) => (
            <option key={tag.id} value={tag.name} />
          ))}
        </datalist>
        <button className="app-btn ghost" type="submit" disabled={adding}>
          足す
        </button>
      </form>

      {addState.error ? (
        <span className="err">
          {addState.error}
          {addState.missing ? (
            <>
              {' '}
              <Link href={tagsPath(target.slug)}>タグを作る</Link>
            </>
          ) : null}
        </span>
      ) : null}
      {dropState.error ? <span className="err">{dropState.error}</span> : null}

      <details>
        <summary>一覧から選ぶ</summary>
        <form action={replace}>
          {hidden(target)}
          <span className="boxes">
            {all.map((tag) => (
              <label key={tag.id}>
                <input
                  type="checkbox"
                  name="tags"
                  value={tag.id}
                  defaultChecked={on.has(tag.id)}
                />
                <TagChip name={tag.name} color={tag.color} />
              </label>
            ))}
          </span>
          <button className="app-btn ghost" type="submit" disabled={saving}>
            保存
          </button>
        </form>
      </details>
      {setState.error ? <span className="err">{setState.error}</span> : null}
    </span>
  );
}
