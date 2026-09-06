import { Suspense } from 'react';
import { LoginForm } from './LoginForm.tsx';

/*
 * 未認証のときに、そのURLのまま出す画面。
 *
 * /login へ送らないのは、行き先を持ち回らずに済ませるためである。
 * /o/acme/p/WEB/t/128 を開いた人は、そのURLでログインし、そのまま着地する。
 */
export function LoginScreen() {
  return (
    <div className="auth-wrap">
      {/* LoginForm は現在地を読むため、境界を置く */}
      <Suspense fallback={<div className="auth-card" />}>
        <LoginForm />
      </Suspense>
    </div>
  );
}
