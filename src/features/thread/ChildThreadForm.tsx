'use client';

import { useActionState, useState } from 'react';
import { withoutReset } from '#lib/field.tsx';
import { type CreateThreadState, createThreadAction } from './actions.ts';

const empty: CreateThreadState = {};

/*
 * このスレッドを親にして、子を立てる。詳細画面の右の欄の足元に置く。
 *
 * 「課題 / 議論 / 質問」の三語が、そのまま種別のラジオである。
 * 押した語が種別なので、開いた先に選択欄を置かない。
 * 三語が並んでいるのに、開いてからもう一度選ばせることになる。
 *
 * 欄を出す役は CSS が持つ（.p-child-new:has(input:checked)）。
 * JavaScript が動かなくても、押せば欄が出て送信できる。
 *
 * 親の番号は画面が持っているので、人に書き写させない。
 * 書き写さない人が出ると、そこで親子が切れる。
 */
export function ChildThreadForm({
  slug,
  projectKey,
  parentNumber,
}: {
  slug: string;
  projectKey: string;
  /** 立てる子の親。この画面のスレッドである */
  parentNumber: number;
}) {
  const [state, action, saving] = useActionState(createThreadAction, empty);
  const [title, setTitle] = useState('');
  const [seen, setSeen] = useState(state.created);

  // 立ったらタイトルだけ空へ戻す。押した語は選ばれたまま残す。
  // 子の課題を続けて並べるときに、毎回押し直すことにならない
  if (seen !== state.created) {
    setSeen(state.created);
    setTitle('');
  }

  // 立てた結果は、すぐ上の子スレッドの一覧に行として出る。知らせは置かない
  const id = `child-type-${parentNumber}`;

  return (
    <form className="p-child-new" action={action} onSubmit={withoutReset(action)}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="key" value={projectKey} />
      <input type="hidden" name="parent" value={parentNumber} />

      <p className="pick">
        このスレッドを親にして
        <br />
        <input type="radio" name="type" id={`${id}-kadai`} value="kadai" />
        <label htmlFor={`${id}-kadai`}>課題</label>
        {' / '}
        <input type="radio" name="type" id={`${id}-giron`} value="giron" />
        <label htmlFor={`${id}-giron`}>議論</label>
        {' / '}
        <input type="radio" name="type" id={`${id}-shitsumon`} value="shitsumon" />
        <label htmlFor={`${id}-shitsumon`}>質問</label>
        {' を作成する'}
      </p>

      <div className="compose">
        <input
          type="text"
          name="title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="タイトル"
          aria-label="子スレッドのタイトル"
          required
        />
        <button className="app-btn ghost" type="submit" disabled={saving}>
          {saving ? '作成中…' : '立てる'}
        </button>
        {state.error ? <span className="err">{state.error}</span> : null}
      </div>
    </form>
  );
}
