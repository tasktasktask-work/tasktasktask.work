'use client';

import { useActionState } from 'react';
import { useField } from '#lib/field.tsx';
import {
  deleteThreadAction,
  editThreadTextAction,
  setThreadArchivedAction,
  type ThreadActionState,
} from './actions.ts';

const empty: ThreadActionState = {};

type Target = { slug: string; projectKey: string; number: number };

function hidden({ slug, projectKey, number }: Target) {
  return (
    <>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="key" value={projectKey} />
      <input type="hidden" name="number" value={number} />
    </>
  );
}

/**
 * タイトルと本文の編集。
 *
 * 既定では閉じてある。この画面の主役は読むことで、書き換えは時々である。
 * 履歴は残らない。残るのは「編集済み」の印と、その時刻だけである。
 */
export function ThreadTextForm({
  target,
  title,
  body,
}: {
  target: Target;
  title: string;
  body: string;
}) {
  const [state, action, saving] = useActionState(editThreadTextAction, empty);
  const [heading, setHeading, headingSettled] = useField(title);
  const [text, setText, textSettled] = useField(body);

  return (
    <details className="app-disclosure" open={Boolean(state.error)}>
      <summary>タイトルと本文を書き換える</summary>

      <form className="app-form" action={action}>
        {hidden(target)}

        {state.error ? <div className="app-note warn">{state.error}</div> : null}
        {state.notice && headingSettled && textSettled ? (
          <div className="app-note ok">{state.notice}</div>
        ) : null}

        <div className="auth-field">
          <label htmlFor="edit-title">タイトル</label>
          <input
            id="edit-title"
            name="title"
            type="text"
            value={heading}
            onChange={(event) => setHeading(event.target.value)}
            required
          />
        </div>

        <div className="auth-field">
          <label htmlFor="edit-body">本文</label>
          <textarea
            id="edit-body"
            name="body"
            rows={12}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </div>

        <p className="app-hint">
          書き換えると「編集済み」の印が付きます。
          前の本文は残りません。すでに付いているコメントが、
          書き換え前の文章に向けられたものである場合があります。
        </p>

        <div className="line">
          <span style={{ flex: 1 }} />
          <button className="app-btn" type="submit" disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </details>
  );
}

/**
 * 畳む、あるいは戻す。
 *
 * 子には連鎖しない。親が終わっていても、子はまだ動いていることがある。
 */
export function ThreadArchiveForm({
  target,
  archived,
  childCount,
}: {
  target: Target;
  archived: boolean;
  childCount: number;
}) {
  const [state, action, saving] = useActionState(setThreadArchivedAction, empty);

  return (
    <form className="app-form" action={action}>
      {hidden(target)}
      <input type="hidden" name="archived" value={archived ? 'false' : 'true'} />

      {state.error ? <div className="app-note warn">{state.error}</div> : null}
      {state.notice ? <div className="app-note ok">{state.notice}</div> : null}

      <div className="line">
        <p style={{ margin: 0, fontSize: '.85rem' }}>
          {archived
            ? 'アーカイブ済みです。読み取り専用になっています。'
            : 'アーカイブすると読み取り専用になります。'}
          {childCount > 0 && !archived
            ? `子スレッドが ${childCount} 件ありますが、そちらは畳まれません。`
            : ''}
        </p>
        <button className="app-btn ghost" type="submit" disabled={saving}>
          {archived ? 'アーカイブを解除' : 'アーカイブする'}
        </button>
      </div>
    </form>
  );
}

/**
 * 消す。組織管理者だけが、畳んだあとにだけ行える。
 *
 * 番号は欠番のまま残る。他のスレッドが使い回すことはない。
 */
export function ThreadDeleteForm({
  target,
  label,
  title,
  archived,
}: {
  target: Target;
  label: string;
  title: string;
  archived: boolean;
}) {
  const [state, action, saving] = useActionState(deleteThreadAction, empty);

  return (
    <form
      className="app-form"
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(`${label} ${title} を削除します。子スレッドは残ります。`)) {
          event.preventDefault();
        }
      }}
    >
      {hidden(target)}

      {state.error ? <div className="app-note warn">{state.error}</div> : null}

      <div className="line">
        <p style={{ margin: 0, fontSize: '.85rem' }}>
          {archived
            ? `削除しても ${label} の番号は欠番のまま残ります。他のスレッドが使い回すことはありません。`
            : 'アーカイブしたスレッドだけを削除できます。'}
        </p>
        <button className="app-btn ghost" type="submit" disabled={saving || !archived}>
          削除する
        </button>
      </div>
    </form>
  );
}
