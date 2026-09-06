import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentUser } from '#features/authentication/cookie.ts';
import { LoginScreen } from '#features/authentication/LoginScreen.tsx';

export const metadata: Metadata = { title: 'ログイン' };

/*
 * ログインのための入口として残してある。
 * メールの文面がこのURLを指しているためである。
 *
 * 未認証の画面はどのURLにも現れるので、ここは特別な場所ではない。
 */
export default async function LoginPage() {
  if (await currentUser()) {
    redirect('/');
  }
  return <LoginScreen />;
}
