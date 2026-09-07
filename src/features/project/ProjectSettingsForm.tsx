'use client';

import { useActionState } from 'react';
import {
  changeVisibilityAction,
  deleteProjectAction,
  type ProjectActionState,
  renameProjectAction,
  setArchivedAction,
} from './actions.ts';

const empty: ProjectActionState = {};

/*
 * プロジェクトの設定。
 *
 * 操作ごとにフォームを分けてある。
 * 名前を保存したときの知らせと、公開設定を切り替えたときの知らせは別物で、
 * ひとつにまとめると、どちらの結果なのかが読めなくなる。
 */

export function RenameProjectForm({
  slug,
  projectKey,
  name,
  description,
}: {
  slug: string;
  projectKey: string;
  name: string;
  description: string;
}) {
  const [state, action, saving] = useActionState(renameProjectAction, empty);

  return (
    <form className="app-form" action={action}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="key" value={projectKey} />

      {state.error ? <div className="app-note warn">{state.error}</div> : null}
      {state.notice ? <div className="app-note ok">{state.notice}</div> : null}

      <div className="line">
        <div className="auth-field" style={{ marginBottom: 0, flex: '0 1 10rem' }}>
          <label htmlFor="settings-key">キー</label>
          <input id="settings-key" type="text" value={projectKey} readOnly disabled />
        </div>
        <div className="auth-field" style={{ marginBottom: 0 }}>
          <label htmlFor="settings-name">プロジェクト名</label>
          <input id="settings-name" name="name" type="text" defaultValue={name} required />
        </div>
      </div>

      <p className="app-hint">
        キーは変えられません。<code>{projectKey}-128</code>{' '}
        として書かれた記録が、過去を指せなくなるためです。
      </p>

      <div className="line" style={{ marginTop: '.7rem' }}>
        <div className="auth-field" style={{ marginBottom: 0 }}>
          <label htmlFor="settings-description">説明</label>
          <input
            id="settings-description"
            name="description"
            type="text"
            defaultValue={description}
          />
        </div>
        <button className="app-btn" type="submit" disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </form>
  );
}

export function VisibilityForm({
  slug,
  projectKey,
  visibility,
  memberCount,
}: {
  slug: string;
  projectKey: string;
  visibility: 'public' | 'private';
  memberCount: number;
}) {
  const [state, action, saving] = useActionState(changeVisibilityAction, empty);
  const next = visibility === 'public' ? 'private' : 'public';

  return (
    <form
      className="app-form"
      action={action}
      onSubmit={(event) => {
        /*
         * 非公開から公開へ戻すことはできても、見られた事実は戻せない。
         * 一手で切り替わらないよう、ここで一度止める。
         */
        const message =
          next === 'public'
            ? 'このプロジェクトを公開します。組織のメンバー全員が、これまでのスレッドも読めるようになります。よろしいですか。'
            : `このプロジェクトを非公開にします。いま登録されている ${memberCount} 人と、組織管理者だけが見られるようになります。よろしいですか。`;
        if (!window.confirm(message)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="key" value={projectKey} />
      <input type="hidden" name="visibility" value={next} />

      {state.error ? <div className="app-note warn">{state.error}</div> : null}
      {state.notice ? <div className="app-note ok">{state.notice}</div> : null}

      <div className="line">
        <p style={{ margin: 0, fontSize: '.85rem' }}>
          いまは<strong>{visibility === 'public' ? '公開' : '非公開'}</strong>です。
          {visibility === 'public'
            ? '組織のメンバー全員が見られます。'
            : `登録された ${memberCount} 人と、組織管理者だけが見られます。`}
        </p>
        <button className="app-btn ghost" type="submit" disabled={saving}>
          {next === 'private' ? '非公開にする' : '公開にする'}
        </button>
      </div>
    </form>
  );
}

export function ArchiveForm({
  slug,
  projectKey,
  archived,
}: {
  slug: string;
  projectKey: string;
  archived: boolean;
}) {
  const [state, action, saving] = useActionState(setArchivedAction, empty);

  return (
    <form className="app-form" action={action}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="key" value={projectKey} />
      <input type="hidden" name="archived" value={archived ? 'false' : 'true'} />

      {state.error ? <div className="app-note warn">{state.error}</div> : null}
      {state.notice ? <div className="app-note ok">{state.notice}</div> : null}

      <div className="line">
        <p style={{ margin: 0, fontSize: '.85rem' }}>
          {archived
            ? 'アーカイブ済みです。中のスレッドは読み取り専用になっています。'
            : 'アーカイブすると、中のスレッドがまとめて読み取り専用になります。個々のスレッドの状態は書き換えないので、解除すれば元どおりです。'}
        </p>
        <button className="app-btn ghost" type="submit" disabled={saving}>
          {archived ? 'アーカイブを解除' : 'アーカイブする'}
        </button>
      </div>
    </form>
  );
}

export function DeleteForm({
  slug,
  projectKey,
  name,
  archived,
}: {
  slug: string;
  projectKey: string;
  name: string;
  archived: boolean;
}) {
  const [state, action, saving] = useActionState(deleteProjectAction, empty);

  return (
    <form
      className="app-form"
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(`${name} を削除します。中のスレッドも見えなくなります。`)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="key" value={projectKey} />

      {state.error ? <div className="app-note warn">{state.error}</div> : null}

      <div className="line">
        <p style={{ margin: 0, fontSize: '.85rem' }}>
          {archived
            ? '削除すると、中のスレッドもまとめて見えなくなります。'
            : 'アーカイブしたプロジェクトだけを削除できます。一覧から一手で消えないようにしてあります。'}
        </p>
        <button className="app-btn ghost" type="submit" disabled={saving || !archived}>
          削除する
        </button>
      </div>
    </form>
  );
}
