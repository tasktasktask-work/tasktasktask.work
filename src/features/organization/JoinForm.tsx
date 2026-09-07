'use client';

import { useActionState } from 'react';
import { MIN_PASSWORD_LENGTH } from '#features/authentication/policy.ts';
import { acceptInvitationAction, type OrgActionState } from './actions.ts';

const empty: OrgActionState = {};

/*
 * 招待を受ける画面のフォーム。
 *
 * すでにそのアドレスのアカウントがある人には、パスワードを訊かない。
 * 訊いて上書きできてしまうと、招待リンクを踏ませるだけで
 * 他人のパスワードを書き換えられることになる。
 */
export function JoinForm({
  token,
  email,
  needsAccount,
}: {
  token: string;
  email: string;
  needsAccount: boolean;
}) {
  const [state, action, joining] = useActionState(acceptInvitationAction, empty);

  return (
    <form action={action}>
      <input type="hidden" name="token" value={token} />

      {state.error ? <div className="app-note warn">{state.error}</div> : null}

      <div className="auth-field">
        <label htmlFor="join-email">メールアドレス</label>
        <input id="join-email" type="email" value={email} readOnly disabled />
      </div>

      {needsAccount ? (
        <>
          <div className="auth-field">
            <label htmlFor="join-name">表示名</label>
            <input
              id="join-name"
              name="displayName"
              type="text"
              autoComplete="name"
              placeholder="佐藤 明日香"
              required
            />
          </div>
          <div className="auth-field">
            <label htmlFor="join-password">パスワード（{MIN_PASSWORD_LENGTH}文字以上）</label>
            <input
              id="join-password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
            />
          </div>
        </>
      ) : null}

      <button className="auth-btn" type="submit" disabled={joining}>
        {joining ? '参加しています…' : '参加する'}
      </button>
    </form>
  );
}
