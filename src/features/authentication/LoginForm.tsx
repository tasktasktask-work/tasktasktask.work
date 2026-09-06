'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useActionState } from 'react';
import { type LoginState, loginWithPassword, requestMagicLinkAction } from './actions.ts';
import { safeReturnTo } from './return-to.ts';

const empty: LoginState = {};

/** マジックリンクが使えなかった理由を、ここで文言にする。 */
const magicNotice: Record<string, string> = {
  invalid: 'そのログイン用リンクは使えません。もう一度受け取ってください。',
  expired: 'ログイン用リンクの有効期間が切れています。もう一度受け取ってください。',
  used: 'そのログイン用リンクは使用済みです。もう一度受け取ってください。',
};

export function LoginForm() {
  const [login, loginAction, loggingIn] = useActionState(loginWithPassword, empty);
  const [magic, magicAction, sendingMagic] = useActionState(requestMagicLinkAction, empty);

  const pathname = usePathname();
  const search = useSearchParams();

  /*
   * ログイン画面はどのURLにも現れる。
   * いま見ている場所を持たせておき、認証が済んだらそこへ戻す。
   * 認証の経過を示す magic は、戻り先に残さない。
   */
  const query = new URLSearchParams(search);
  query.delete('magic');
  const rest = query.toString();
  const returnTo = safeReturnTo(rest ? `${pathname}?${rest}` : pathname);

  const linkProblem = magicNotice[search.get('magic') ?? ''];
  const notice = login.error ?? magic.error ?? magic.notice ?? linkProblem;
  const isError = Boolean(login.error ?? magic.error ?? linkProblem);

  return (
    <div className="auth-card">
      <div className="brand">
        <span className="m">3</span>TASK3
      </div>
      <div className="tag">issue &amp; discussion tracker</div>

      {notice ? (
        <div
          className={isError ? 'note warn' : 'note ok'}
          style={{ marginBottom: '1.2rem', maxWidth: 'none' }}
        >
          <p style={{ margin: 0 }}>{notice}</p>
        </div>
      ) : null}

      <form action={loginAction}>
        <input type="hidden" name="returnTo" value={returnTo} />
        <div className="auth-field">
          <label htmlFor="email">メールアドレス</label>
          <input id="email" name="email" type="email" autoComplete="username" required />
        </div>
        <div className="auth-field">
          <label htmlFor="password">パスワード</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        <button className="auth-btn" type="submit" disabled={loggingIn}>
          {loggingIn ? 'ログインしています…' : 'ログイン'}
        </button>
      </form>

      <div className="auth-or">または</div>

      <form action={magicAction}>
        <div className="auth-field">
          <label htmlFor="magic-email">メールアドレス</label>
          <input id="magic-email" name="email" type="email" autoComplete="username" required />
        </div>
        <button className="auth-btn alt" type="submit" disabled={sendingMagic}>
          {sendingMagic ? '送っています…' : 'ログイン用リンクをメールで受け取る'}
        </button>
      </form>

      <p
        style={{
          fontSize: '.73rem',
          color: 'var(--ink-soft)',
          margin: '.7rem 0 0',
          lineHeight: 1.75,
          textAlign: 'center',
        }}
      >
        リンクは48時間有効で、一度使うと無効になります。
        <br />
        パスワードを忘れた場合もこちらから入れます。
      </p>
    </div>
  );
}
