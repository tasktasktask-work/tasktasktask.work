'use client';

import { useActionState } from 'react';
import { Told, useField, withoutReset } from '#lib/field.tsx';
import {
  addProjectMemberAction,
  type ProjectActionState,
  removeProjectMemberAction,
} from './actions.ts';

const empty: ProjectActionState = {};

/*
 * 非公開プロジェクトのメンバー。
 *
 * 追加できる相手は、この組織のメンバーだけである。
 * 自由入力ではなく選択にしてあるのは、打ち間違いを弾くためというより、
 * 組織の外の人をここから入れられないことを画面の形で示すためである。
 */

export function AddMemberForm({
  slug,
  projectKey,
  candidates,
}: {
  slug: string;
  projectKey: string;
  candidates: { userId: string; displayName: string }[];
}) {
  const [state, action, saving] = useActionState(addProjectMemberAction, empty);

  if (candidates.length === 0) {
    return (
      <p className="app-empty">組織のメンバーは全員このプロジェクトに登録されています。</p>
    );
  }

  return (
    <form className="app-form" action={action}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="key" value={projectKey} />

      {state.error ? <div className="app-note warn">{state.error}</div> : null}
      {state.notice ? <div className="app-note ok">{state.notice}</div> : null}

      <div className="line">
        <div className="auth-field" style={{ marginBottom: 0 }}>
          <label htmlFor="add-member">組織のメンバーから選ぶ</label>
          <select id="add-member" name="userId" required defaultValue="">
            <option value="" disabled>
              選んでください
            </option>
            {candidates.map((candidate) => (
              <option key={candidate.userId} value={candidate.userId}>
                {candidate.displayName}
              </option>
            ))}
          </select>
        </div>
        <div className="auth-field" style={{ marginBottom: 0, flex: '0 1 12rem' }}>
          <label htmlFor="add-member-role">権限</label>
          <select id="add-member-role" name="isAdmin" defaultValue="false">
            <option value="false">メンバー</option>
            <option value="true">プロジェクト管理者</option>
          </select>
        </div>
        <button className="app-btn" type="submit" disabled={saving}>
          {saving ? '追加中…' : '追加'}
        </button>
      </div>
    </form>
  );
}

export function ChangeMemberRoleForm({
  slug,
  projectKey,
  userId,
  isAdmin,
}: {
  slug: string;
  projectKey: string;
  userId: string;
  isAdmin: boolean;
}) {
  const [state, action, saving] = useActionState(addProjectMemberAction, empty);
  const [value, setValue, settled] = useField(String(isAdmin));

  return (
    <form action={action} onSubmit={withoutReset(action)}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="key" value={projectKey} />
      <input type="hidden" name="userId" value={userId} />
      <select
        name="isAdmin"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        disabled={saving}
        aria-label="権限"
      >
        <option value="false">メンバー</option>
        <option value="true">プロジェクト管理者</option>
      </select>
      <button className="app-btn ghost" type="submit" disabled={saving}>
        変更
      </button>
      <Told state={state} settled={settled} />
    </form>
  );
}

export function RemoveMemberForm({
  slug,
  projectKey,
  userId,
  displayName,
  visibility,
}: {
  slug: string;
  projectKey: string;
  userId: string;
  displayName: string;
  visibility: 'public' | 'private';
}) {
  const [state, action, saving] = useActionState(removeProjectMemberAction, empty);

  return (
    <form
      action={action}
      onSubmit={(event) => {
        const tail =
          visibility === 'private'
            ? 'このプロジェクトが見えなくなります。'
            : '公開プロジェクトなので、見える範囲は変わりません。';
        if (!window.confirm(`${displayName} さんを外します。${tail}`)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="key" value={projectKey} />
      <input type="hidden" name="userId" value={userId} />
      <button className="app-btn ghost" type="submit" disabled={saving}>
        外す
      </button>
      {state.error ? <span className="err">{state.error}</span> : null}
    </form>
  );
}
