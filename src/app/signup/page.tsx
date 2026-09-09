import type { Metadata } from 'next';
import Link from 'next/link';
import { logout } from '#features/authentication/actions.ts';
import { currentUser } from '#features/authentication/cookie.ts';
import { CreateOrgForm } from '#features/organization/CreateOrgForm.tsx';
import { SignupStartForm } from '#features/organization/SignupStartForm.tsx';
import { previewSignup, type SignupProblem } from '#features/organization/signup.ts';
import { env } from '#lib/env.ts';

export const metadata: Metadata = { title: '組織を作る' };

/*
 * 組織を作る画面。
 *
 * 三つの顔を持つ。
 *   token あり      リンクの着地点。組織名と slug を訊く
 *   ログイン済み    確認を挟まず、その場で作る
 *   それ以外        入口。メールアドレスだけを訊く
 *
 * URL をひとつにしてあるのは、入力欄を二箇所に持たないためである。
 * 分けると、slug の説明文と検証が片方だけ古くなる。
 */

const PROBLEM: Record<SignupProblem, string> = {
  invalid: 'このリンクは使えません。もう一度受け取ってください。',
  expired: 'このリンクの有効期間（48時間）が切れています。もう一度受け取ってください。',
  used: 'このリンクはすでに使われています。ログインしてください。',
};

/** 入力欄の前に出すURLの形。http:// と末尾のスラッシュを落とす。 */
function urlPrefix(): string {
  return `${env.APP_ORIGIN.replace(/^https?:\/\//, '').replace(/\/$/, '')}/o/`;
}

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (token) {
    return <FromLink token={token} />;
  }

  const user = await currentUser();
  return user ? <LoggedIn displayName={user.displayName} email={user.email} /> : <Entrance />;
}

/* -------------------------------------------------------------------------- */

function Entrance() {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand">
          <span className="m">3</span>TASK3
        </div>
        <div className="tag">組織を新しく作る</div>

        <SignupStartForm />

        <div className="auth-or">または</div>

        <Link
          className="auth-btn alt"
          href="/login"
          style={{ display: 'block', textAlign: 'center' }}
        >
          ログインする
        </Link>
      </div>
    </div>
  );
}

async function FromLink({ token }: { token: string }) {
  const result = await previewSignup(token);

  if (!result.ok) {
    /*
     * 招待と違い、この人は自分で送り直せる。
     * 誰かに頼む方法を書くより、送り直す欄をその場に出すほうが早い。
     */
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <div className="brand">
            <span className="m">3</span>TASK3
          </div>
          <div className="app-note warn">
            <p style={{ margin: 0 }}>{PROBLEM[result.reason]}</p>
          </div>
          <div style={{ marginTop: '1.1rem' }}>
            <SignupStartForm />
          </div>
        </div>
      </div>
    );
  }

  const { preview } = result;

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand">
          <span className="m">3</span>TASK3
        </div>
        <div className="tag">組織を新しく作る</div>

        <div className="auth-field">
          <label htmlFor="signup-confirmed">メールアドレス</label>
          <input disabled id="signup-confirmed" type="email" value={preview.email} readOnly />
        </div>

        <CreateOrgForm
          needsAccount={preview.needsAccount}
          token={token}
          urlPrefix={urlPrefix()}
        />

        {preview.needsAccount ? (
          <p
            style={{
              fontSize: '.73rem',
              color: 'var(--ink-soft)',
              margin: '.9rem 0 0',
              lineHeight: 1.75,
              textAlign: 'center',
            }}
          >
            作った人が、その組織の組織管理者になります。
          </p>
        ) : (
          <p style={{ fontSize: '.76rem', color: 'var(--ink-soft)', marginTop: '.9rem' }}>
            このメールアドレスのアカウントはすでにあります。パスワードは変わりません。
          </p>
        )}
      </div>
    </div>
  );
}

function LoggedIn({ displayName, email }: { displayName: string; email: string }) {
  return (
    <div className="app-frame">
      <div className="app-top">
        <span className="app-logo">
          <span className="m">3</span>TASK3
        </span>
        <span className="sp" />
        <span aria-hidden="true" className="hanko sm">
          {[...displayName][0] ?? '?'}
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
            <h2>組織を作る</h2>
            <div className="sub">
              {displayName}（{email}）
            </div>
          </div>
        </div>

        {/* 確認のメールを挟まない。このアドレスはログインできている時点で確認済みである */}
        <div style={{ maxWidth: '34rem' }}>
          <CreateOrgForm urlPrefix={urlPrefix()} />
        </div>
      </div>
    </div>
  );
}
