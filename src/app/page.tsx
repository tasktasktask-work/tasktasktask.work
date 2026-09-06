import { logout } from '#features/authentication/actions.ts';
import { currentUser } from '#features/authentication/cookie.ts';
import { LoginScreen } from '#features/authentication/LoginScreen.tsx';

/**
 * ログイン後の着地点。
 *
 * 組織とプロジェクトの機能を実装したら、
 * /o/{slug} のプロジェクト一覧へ送る形に差し替える。
 */
export default async function Home() {
  const user = await currentUser();

  // 未認証なら、このURLのままログイン画面を出す。/login へは送らない。
  if (!user) {
    return <LoginScreen />;
  }

  return (
    <div className="app-frame">
      <div className="app-top">
        <span className="app-logo">
          <span className="m">3</span>TASK3
        </span>
        <span className="sp" />
        <span className="hanko sm" aria-hidden="true">
          {[...user.displayName][0] ?? '?'}
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
            <h2>ログインしています</h2>
            <div className="sub">
              {user.displayName}（{user.email}）
            </div>
          </div>
        </div>
        <p className="app-empty">組織とプロジェクトの画面はこれから作ります。</p>
      </div>
    </div>
  );
}
