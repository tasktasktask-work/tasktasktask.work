'use client';

import { useActionState } from 'react';
import { Told, useField } from '#lib/field.tsx';
import {
  changeRoleAction,
  type OrgActionState,
  removeMemberAction,
  revokeInvitationAction,
} from './actions.ts';

const empty: OrgActionState = {};

/*
 * メンバー一行ぶんの操作。
 *
 * 行ごとに状態を持たせてある。
 * 画面でひとつにまとめると、どの人について失敗したのかが分からなくなる。
 * 「最後の組織管理者は降ろせない」は、まさにその一人について出る知らせである。
 */

export function RoleForm({
  slug,
  userId,
  role,
  self,
}: {
  slug: string;
  userId: string;
  role: 'admin' | 'member';
  self: boolean;
}) {
  const [state, action, saving] = useActionState(changeRoleAction, empty);
  const [value, setValue, settled] = useField(role);

  return (
    <form action={action}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="userId" value={userId} />
      <select
        name="role"
        value={value}
        onChange={(event) => setValue(event.target.value as 'admin' | 'member')}
        disabled={saving}
        aria-label="役割"
      >
        <option value="member">メンバー</option>
        <option value="admin">組織管理者</option>
      </select>
      <button className="app-btn ghost" type="submit" disabled={saving}>
        変更
      </button>
      {self ? (
        <span className="ad" style={{ display: 'inline' }}>
          あなた
        </span>
      ) : null}
      <Told state={state} settled={settled} />
    </form>
  );
}

export function RemoveForm({
  slug,
  userId,
  displayName,
}: {
  slug: string;
  userId: string;
  displayName: string;
}) {
  const [state, action, removing] = useActionState(removeMemberAction, empty);

  return (
    <form
      action={action}
      onSubmit={(event) => {
        // 外すと、その人には組織の中が何も見えなくなる。取り消しの手段は招待し直しだけ。
        if (!window.confirm(`${displayName} さんを組織から外します。よろしいですか。`)) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="userId" value={userId} />
      <button className="app-btn ghost" type="submit" disabled={removing}>
        外す
      </button>
      {state.error ? <span className="err">{state.error}</span> : null}
    </form>
  );
}

export function RevokeForm({ slug, invitationId }: { slug: string; invitationId: string }) {
  const [state, action, revoking] = useActionState(revokeInvitationAction, empty);

  return (
    <form action={action}>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="invitationId" value={invitationId} />
      <button className="app-btn ghost" type="submit" disabled={revoking}>
        取り消す
      </button>
      {state.error ? <span className="err">{state.error}</span> : null}
    </form>
  );
}
