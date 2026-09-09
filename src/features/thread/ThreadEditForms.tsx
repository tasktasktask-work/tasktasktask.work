'use client';

import { type ReactNode, useActionState, useEffect, useRef } from 'react';
import { useField, withoutReset } from '#lib/field.tsx';
import {
  deleteThreadAction,
  editThreadBodyAction,
  editThreadTitleAction,
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

/* ==========================================================================
   読みと書きを入れ替える欄

   この画面の主役は読むことである。だから既定では読み表示だけが出ている。
   ただし畳んだ欄を画面のどこか一箇所にまとめると、
   直したい対象と、直す欄が離れる。タイトルは上端、欄は最下部という形になっていた。

   そこで欄を対象の隣に置き、押すと表示が入れ替わるようにした。
   読み表示を隠す役は CSS が持つ（:has()）。
   開閉そのものは details の素の挙動なので、JavaScript が動かなくても入口は働く。

   読み表示と欄を同じ部品が出しているのは、隣り合っていることが CSS の前提だからである。
   あいだに何かを挟むと、隠す規則が届かなくなる。
   ========================================================================== */

/**
 * 入れ替え式の欄。
 *
 * 保存できたら閉じる。閉じるのは DOM の属性を外す形で行う。
 * open を props で渡すと、人が summary を押して開いた状態と、
 * こちらが決める状態が食い違う。
 */
function Swap({
  label,
  className,
  saved,
  children,
}: {
  label: ReactNode;
  className?: string | undefined;
  /** 保存できた回数。増えたら閉じる */
  saved: number;
  children: (close: () => void) => ReactNode;
}) {
  const box = useRef<HTMLDetailsElement>(null);
  const close = () => box.current?.removeAttribute('open');

  useEffect(() => {
    if (saved > 0) {
      box.current?.removeAttribute('open');
    }
  }, [saved]);

  return (
    <details className={className ? `app-edit ${className}` : 'app-edit'} ref={box}>
      <summary>{label}</summary>
      {children(close)}
    </details>
  );
}

/** 保存できた回数を数える。知らせが新しく出るたびに一つ増える。 */
function useSaved(state: ThreadActionState): number {
  const count = useRef(0);
  const last = useRef<string | undefined>(undefined);
  if (state.notice !== last.current) {
    last.current = state.notice;
    if (state.notice) {
      count.current += 1;
    }
  }
  return count.current;
}

/**
 * タイトルの読みと書き。
 *
 * ここでは「編集済み」の印を押さない。
 * 誤字を一文字直しただけで印が付くと、それを見た人は、
 * 並んでいるコメントが古い本文に向けられていないかを毎回疑うことになる。
 */
export function ThreadTitle({
  target,
  title,
  canWrite,
}: {
  target: Target;
  title: string;
  canWrite: boolean;
}) {
  const [state, action, saving] = useActionState(editThreadTitleAction, empty);
  const [heading, setHeading, settled] = useField(title);
  const saved = useSaved(state);

  if (!canWrite) {
    return <h2>{title}</h2>;
  }

  return (
    <>
      {state.notice && settled ? <p className="app-note ok">{state.notice}</p> : null}

      <h2>{title}</h2>

      <Swap label="編集" saved={saved}>
        {(close) => (
          <form className="app-form" action={action} onSubmit={withoutReset(action)}>
            {hidden(target)}

            {state.error ? <div className="app-note warn">{state.error}</div> : null}

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

            <div className="line">
              <span style={{ flex: 1 }} />
              <button className="app-btn ghost" type="button" onClick={close} disabled={saving}>
                やめる
              </button>
              <button className="app-btn" type="submit" disabled={saving}>
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </form>
        )}
      </Swap>
    </>
  );
}

/**
 * 本文の読みと書き。
 *
 * 入口は本文の直下にある。右上ではないのは、本文が長いときに、
 * 読み終わった位置から入口までの距離を作らないためである。
 *
 * 描いた本文はサーバー側から children で受け取る。
 * Markdown の解釈と無害化はサーバーの仕事で、ここへは持ち込まない。
 */
export function ThreadBody({
  target,
  body,
  canWrite,
  children,
}: {
  target: Target;
  body: string;
  canWrite: boolean;
  /** 描いた本文。空のときは null */
  children: ReactNode;
}) {
  const [state, action, saving] = useActionState(editThreadBodyAction, empty);
  const [text, setText, settled] = useField(body);
  const saved = useSaved(state);
  const blank = children === null;

  if (!canWrite) {
    return blank ? (
      <p className="app-empty">本文はまだありません。</p>
    ) : (
      <div className="app-body-md">{children}</div>
    );
  }

  const form = (close: () => void) => (
    <form className="app-form" action={action} onSubmit={withoutReset(action)}>
      {hidden(target)}

      {state.error ? <div className="app-note warn">{state.error}</div> : null}

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
        書き換えると「本文編集済み」の印が付きます。 前の本文は残りません。
        すでに付いているコメントが、 書き換え前の文章に向けられたものである場合があります。
      </p>

      <div className="line">
        <span style={{ flex: 1 }} />
        <button className="app-btn ghost" type="button" onClick={close} disabled={saving}>
          やめる
        </button>
        <button className="app-btn" type="submit" disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </form>
  );

  return (
    <>
      {state.notice && settled ? <p className="app-note ok">{state.notice}</p> : null}

      {/* 本文がまだ無いときは、空の知らせの一行そのものが入口になる。
          その下に押しどころをもう一つ並べない */}
      {blank ? null : <div className="app-body-md">{children}</div>}

      <Swap
        label={blank ? '本文はまだありません。' : '編集'}
        className={blank ? 'blank' : undefined}
        saved={saved}
      >
        {form}
      </Swap>
    </>
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
    <form className="app-form" action={action} onSubmit={withoutReset(action)}>
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
 * この欄を出すかどうかは画面の側が決める。
 * 出るときには必ず押せるので、ここに押せない状態は無い
 * （「できない操作は消す。無効化して残さない」）。
 *
 * 番号は欠番のまま残る。他のスレッドが使い回すことはない。
 */
export function ThreadDeleteForm({
  target,
  label,
  title,
}: {
  target: Target;
  label: string;
  title: string;
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
          削除しても {label}{' '}
          の番号は欠番のまま残ります。他のスレッドが使い回すことはありません。
        </p>
        <button className="app-btn ghost" type="submit" disabled={saving}>
          削除する
        </button>
      </div>
    </form>
  );
}
