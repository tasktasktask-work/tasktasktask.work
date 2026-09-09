'use client';

import { useActionState } from 'react';
import { withoutReset } from '#lib/field.tsx';
import { type OrgActionState, startSignupAction } from './actions.ts';

const empty: OrgActionState = {};

/*
 * 組織登録の入口。
 *
 * 訊くのはメールアドレスだけである。
 * 組織名をここで訊くと、リンクが踏まれるまでのあいだ、
 * 使われるとは限らない組織名を預かることになる。
 */
export function SignupStartForm({ email = '' }: { email?: string }) {
  const [state, action, sending] = useActionState(startSignupAction, empty);

  /*
   * 欄の値は画面の側で持たない。
   * useField の settled は「サーバから来た値と揃っているか」であり、
   * 種が空文字のこの欄では、打った時点で永久に揃わなくなる。
   * 送り終えたら欄ごと消えるので、揃えるべき相手もいない。
   */
  if (state.notice) {
    return (
      <>
        <div className="app-note ok">
          <p style={{ margin: 0 }}>{state.notice}</p>
        </div>
        <p
          style={{
            fontSize: '.73rem',
            color: 'var(--ink-soft)',
            margin: '.9rem 0 0',
            lineHeight: 1.75,
            textAlign: 'center',
          }}
        >
          届かない場合は、迷惑メールの振り分けを確認してください。
          <br />
          しばらく待ってから、もう一度受け取ることもできます。
        </p>
      </>
    );
  }

  return (
    <form action={action} onSubmit={withoutReset(action)}>
      {state.error ? <div className="app-note warn">{state.error}</div> : null}

      <div className="auth-field">
        <label htmlFor="signup-email">メールアドレス</label>
        {/* withoutReset が送信のたびの巻き戻しを止める。断られても打った値が残る */}
        <input
          autoComplete="email"
          defaultValue={email}
          id="signup-email"
          name="email"
          required
          type="email"
        />
      </div>

      <button className="auth-btn" disabled={sending} type="submit">
        {sending ? '送っています…' : '確認のリンクを受け取る'}
      </button>

      <p
        style={{
          fontSize: '.73rem',
          color: 'var(--ink-soft)',
          margin: '.7rem 0 0',
          lineHeight: 1.75,
          textAlign: 'center',
        }}
      >
        リンクを開くと、組織の名前を決める画面に進みます。
        <br />
        リンクは48時間有効です。
      </p>
    </form>
  );
}
