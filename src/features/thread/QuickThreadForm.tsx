'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { withoutReset } from '#lib/field.tsx';
import { type CreateThreadState, createThreadAction } from './actions.ts';
import { threadLabel, threadPath } from './path.ts';
import type { ThreadType } from './queries.ts';

const empty: CreateThreadState = {};

/*
 * スレッドを立てる。一覧の見出しとタブのあいだに置く一行である。
 *
 * 立てるのに要るのは種別とタイトルだけで、本文も担当者も期間もタグも
 * 立てた先の画面で入れる。
 * 立てる時点で本文が固まっていないスレッドのほうが多い。
 * 議論と質問は、何が決まっていないのかを言えないから相談として置くものである。
 *
 * 種別は後から変えられない。
 * 議論としてここに書いたものを課題に作り変えることはできず、
 * 課題を別に立てて、この議論を親にすることになる。
 */
export function QuickThreadForm({ slug, projectKey }: { slug: string; projectKey: string }) {
  const [state, action, saving] = useActionState(createThreadAction, empty);
  // 立てても画面は移動しない。種別は選んだまま残す。
  // 続けて三件立てるときに、毎回選び直すことになる
  const [type, setType] = useState<ThreadType>('kadai');
  const [title, setTitle] = useState('');
  const [seen, setSeen] = useState(state.created);

  // 立ったらタイトルだけ空へ戻す。描いている途中で合わせ直すので、
  // 古い値で一度描いてから消える、という見え方にならない
  if (seen !== state.created) {
    setSeen(state.created);
    setTitle('');
  }

  return (
    <form className="app-new" action={action} onSubmit={withoutReset(action)}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="key" value={projectKey} />

      <select
        name="type"
        value={type}
        onChange={(event) => setType(event.target.value as ThreadType)}
        aria-label="種別"
      >
        <option value="kadai">課題</option>
        <option value="giron">議論</option>
        <option value="shitsumon">質問</option>
      </select>

      <input
        type="text"
        name="title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="スレッドのタイトル"
        aria-label="タイトル"
        required
      />

      <button className="app-btn" type="submit" disabled={saving}>
        {saving ? '作成中…' : '立てる'}
      </button>

      {state.error ? <span className="err">{state.error}</span> : null}

      {/*
        立てた番号を出す。絞り込みの条件から外れた行は一覧に現れないので、
        これが結果を伝える唯一の手段になることがある。
        残すのは直近の一件だけである。積むと、フォームの位置が下へずれていく
      */}
      {state.created !== undefined && !state.error ? (
        <span className="told">
          <Link href={threadPath(slug, projectKey, state.created)}>
            {threadLabel(projectKey, state.created)}
          </Link>{' '}
          を立てました
        </span>
      ) : null}
    </form>
  );
}
