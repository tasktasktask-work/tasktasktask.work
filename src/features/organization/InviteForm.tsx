'use client';

import { useActionState } from 'react';
import { inviteMemberAction, type OrgActionState } from './actions.ts';

const empty: OrgActionState = {};

/*
 * 招待を送るフォーム。
 *
 * 送れるのは組織管理者だけだが、その判定はここでは行わない。
 * 画面に出さないことは防御ではないので、確かめるのは SQL の側である。
 */
export function InviteForm({ slug }: { slug: string }) {
  const [state, action, sending] = useActionState(inviteMemberAction, empty);

  return (
    <form className="app-form" action={action}>
      <input type="hidden" name="slug" value={slug} />

      {state.error ? <div className="app-note warn">{state.error}</div> : null}
      {state.notice ? <div className="app-note ok">{state.notice}</div> : null}

      <div className="line">
        <div className="auth-field" style={{ marginBottom: 0 }}>
          <label htmlFor="invite-email">招待するメールアドレス</label>
          <input
            id="invite-email"
            name="email"
            type="email"
            autoComplete="off"
            placeholder="someone@example.com"
            required
          />
        </div>

        <div className="auth-field" style={{ marginBottom: 0, flex: '0 1 10rem' }}>
          <label htmlFor="invite-role">役割</label>
          <select id="invite-role" name="role" defaultValue="member">
            <option value="member">メンバー</option>
            <option value="admin">組織管理者</option>
          </select>
        </div>

        <button className="app-btn" type="submit" disabled={sending}>
          {sending ? '送信中…' : '招待を送る'}
        </button>
      </div>
    </form>
  );
}
