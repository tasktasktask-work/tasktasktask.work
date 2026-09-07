import Link from 'next/link';
import { logout } from '#features/authentication/actions.ts';
import { currentUser } from '#features/authentication/cookie.ts';
import { LoginScreen } from '#features/authentication/LoginScreen.tsx';
import { listMemberships } from '#features/organization/queries.ts';

/**
 * ログイン後の着地点。所属している組織が並ぶ。
 *
 * 組織がひとつだけでも、ここへ着地させて一覧を出す。
 * 直行させると、二つめの組織に招待された日から着地点が変わる。
 * 毎日同じ場所に着くほうを取った。
 */
export default async function Home() {
  const user = await currentUser();

  // 未認証なら、このURLのままログイン画面を出す。/login へは送らない。
  if (!user) {
    return <LoginScreen />;
  }

  const memberships = await listMemberships(user.userId);

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
            <h2>組織</h2>
            <div className="sub">
              {user.displayName}（{user.email}）
            </div>
          </div>
        </div>

        {memberships.length === 0 ? (
          <p className="app-empty">
            所属している組織がありません。
            <br />
            招待を受け取ると、そのリンクから参加できます。
          </p>
        ) : (
          <div className="cards">
            {memberships.map((membership) => (
              <Link
                className="card"
                href={`/o/${membership.slug}`}
                key={membership.organizationId}
              >
                <span className="card-no">{membership.slug}</span>
                <p className="card-title">{membership.name}</p>
                <p className="card-desc">
                  {membership.role === 'admin' ? '組織管理者' : 'メンバー'}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
