import type { Metadata } from 'next';
import Link from 'next/link';
import { EmailNotificationsForm } from '#features/account/EmailNotificationsForm.tsx';
import { getAccount } from '#features/account/queries.ts';
import { logout } from '#features/authentication/actions.ts';
import { currentUser } from '#features/authentication/cookie.ts';
import { LoginScreen } from '#features/authentication/LoginScreen.tsx';

export const metadata: Metadata = { title: 'アカウント' };

/*
 * アカウントの設定。
 *
 * 組織の下に置いていない。ここで切り替える値は users にあり、
 * 所属している組織すべてに効く。/o/{slug}/... の下に置くと、
 * その組織だけの設定に見える。
 *
 * 左帯は出さない。組織に属していない人もここへ来られる必要があり、
 * 属していなければ並べるプロジェクトが無い。
 * 組織の一覧（/）と同じ、上帯だけの枠を使う。
 *
 * 置ける項目は今のところ一つしかない。
 * 残りは docs/issues/account-settings/ にある。
 */
export default async function AccountPage() {
  const user = await currentUser();
  if (!user) {
    return <LoginScreen />;
  }

  const account = await getAccount(user.userId);
  if (!account) {
    return <LoginScreen />;
  }

  return (
    <div className="app-frame">
      <div className="app-top">
        <Link href="/" className="app-logo" style={{ textDecoration: 'none' }}>
          <span className="m">3</span>TASK3
        </Link>
        <span className="sp" />
        <span className="hanko sm" aria-hidden="true">
          {[...account.displayName][0] ?? '?'}
        </span>
        <form action={logout}>
          <button className="app-btn ghost" type="submit">
            ログアウト
          </button>
        </form>
      </div>

      <div className="app-main">
        <div className="app-head">
          <div>
            <h2>アカウント</h2>
            <div className="sub">
              {account.displayName}（{account.email}）
            </div>
          </div>
        </div>

        <div className="app-props" style={{ maxWidth: '34rem' }}>
          <div className="row">
            <span className="k">通知メール</span>
            <span className="v">
              <EmailNotificationsForm enabled={account.emailNotificationsEnabled} />
            </span>
          </div>
        </div>

        <div className="app-note">
          <p style={{ margin: 0 }}>
            この設定は、所属しているすべての組織に効きます。
            きっかけごとの細かい切り替えは持っていません。
            止めているあいだも、通知そのものは組織ごとの一覧に積まれ続けます。
            ログイン用のリンクと招待は、この設定に関わらず届きます。
          </p>
        </div>
      </div>
    </div>
  );
}
