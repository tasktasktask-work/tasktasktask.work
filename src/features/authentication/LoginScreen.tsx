import Link from 'next/link';
import { Suspense } from 'react';
import { PUBLIC_PAGES } from '#features/public/PublicPage.tsx';
import { LoginForm } from './LoginForm.tsx';

/*
 * 未認証のときに、そのURLのまま出す画面。
 *
 * /login へ送らないのは、行き先を持ち回らずに済ませるためである。
 * /o/acme/p/WEB/t/128 を開いた人は、そのURLでログインし、そのまま着地する。
 */
export function LoginScreen() {
  return (
    <>
      <div className="auth-wrap">
        {/* LoginForm は現在地を読むため、境界を置く */}
        <Suspense fallback={<div className="auth-card" />}>
          <LoginForm />
        </Suspense>
      </div>

      {/*
        料金と規約への道。ログインの手前に置く。
        後ろに置くと、外から読めない。決済代行の審査もここを辿る。
      */}
      <div className="pub" style={{ paddingTop: 0, paddingBottom: '2rem' }}>
        <nav className="pub-foot" style={{ marginTop: 0, justifyContent: 'center' }}>
          {PUBLIC_PAGES.map((page) => (
            <Link key={page.path} href={page.path}>
              {page.label}
            </Link>
          ))}
        </nav>
      </div>
    </>
  );
}
