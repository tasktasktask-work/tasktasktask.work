'use client';

import { useActionState } from 'react';
import { MIN_PASSWORD_LENGTH } from '#features/authentication/policy.ts';
import { useField, withoutReset } from '#lib/field.tsx';
import {
  completeSignupAction,
  createOrganizationAction,
  type OrgActionState,
} from './actions.ts';
import { SLUG_HINT } from './slug.ts';

const empty: OrgActionState = {};

/*
 * 組織を作る欄。
 *
 * 三つの場面で同じものを使う。
 *   確認リンクの先（アカウントが無い）  表示名とパスワードも訊く
 *   確認リンクの先（アカウントがある）  組織名と slug だけ
 *   ログイン済み                        組織名と slug だけ、トークンも無し
 *
 * 欄を場面ごとに分けて持つと、slug の説明文が片方だけ古くなる。
 */
export function CreateOrgForm({
  token,
  needsAccount = false,
  urlPrefix,
}: {
  token?: string | undefined;
  needsAccount?: boolean;
  /** 入力欄の前に出すURLの形（例 tasktasktask.work/o/）。 */
  urlPrefix: string;
}) {
  const [state, action, working] = useActionState(
    token ? completeSignupAction : createOrganizationAction,
    empty,
  );

  /*
   * 送信に失敗しても、打ち込んだ値を残す。
   * slug が埋まっていただけの人に、組織名から書き直させない。
   */
  const [name, setName] = useField('');
  const [slug, setSlug] = useField('');

  return (
    <form action={action} onSubmit={withoutReset(action)}>
      {token ? <input name="token" type="hidden" value={token} /> : null}

      {state.error ? <div className="app-note warn">{state.error}</div> : null}

      <div className="auth-field">
        <label htmlFor="org-new-name">組織名</label>
        <input
          id="org-new-name"
          name="organizationName"
          onChange={(event) => setName(event.target.value)}
          placeholder="株式会社アクメ"
          required
          type="text"
          value={name}
        />
      </div>

      <div className="auth-field">
        <label htmlFor="org-new-slug">URL に使う名前</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem' }}>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '.78rem',
              color: 'var(--ink-soft)',
              whiteSpace: 'nowrap',
            }}
          >
            {urlPrefix}
          </span>
          <input
            id="org-new-slug"
            name="slug"
            onChange={(event) => setSlug(event.target.value)}
            placeholder="acme"
            required
            style={{ flex: 1, minWidth: 0 }}
            type="text"
            value={slug}
          />
        </div>
        <p className="app-hint">{SLUG_HINT}</p>
      </div>

      {needsAccount ? (
        <>
          <div className="auth-field">
            <label htmlFor="org-new-display">表示名</label>
            <input
              autoComplete="name"
              id="org-new-display"
              name="displayName"
              placeholder="佐藤 明日香"
              required
              type="text"
            />
          </div>
          <div className="auth-field">
            <label htmlFor="org-new-password">
              パスワード（{MIN_PASSWORD_LENGTH}文字以上）
            </label>
            <input
              autoComplete="new-password"
              id="org-new-password"
              minLength={MIN_PASSWORD_LENGTH}
              name="password"
              required
              type="password"
            />
          </div>
        </>
      ) : null}

      <button className="auth-btn" disabled={working} type="submit">
        {working ? '作っています…' : '組織を作る'}
      </button>
    </form>
  );
}
