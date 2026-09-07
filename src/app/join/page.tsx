import type { Metadata } from 'next';
import Link from 'next/link';
import {
  type InvitationProblem,
  previewInvitation,
} from '#features/organization/invitations.ts';
import { JoinForm } from '#features/organization/JoinForm.tsx';

export const metadata: Metadata = { title: '招待' };

/*
 * 招待の着地点。
 *
 * トークンは問い合わせに載る。マジックリンクと同じ形である。
 * 開いただけでは何も起きない。参加は送信して初めて成立する。
 * 先読みするメールソフトに、勝手に受諾させないためである。
 */

const PROBLEM: Record<InvitationProblem, string> = {
  invalid: 'この招待リンクは使えません。招待した人に送り直しを頼んでください。',
  expired: '招待の有効期間（48時間）が切れています。招待した人に送り直しを頼んでください。',
  revoked: 'この招待は取り消されています。',
  used: 'この招待はすでに使われています。ログインしてください。',
};

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const result = token
    ? await previewInvitation(token)
    : ({ ok: false, reason: 'invalid' } as const);

  if (!result.ok) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <div className="brand">
            <span className="m">3</span>TASK3
          </div>
          <div className="app-note warn">
            <p style={{ margin: 0 }}>{PROBLEM[result.reason]}</p>
          </div>
          <Link
            className="auth-btn alt"
            href="/"
            style={{ display: 'block', textAlign: 'center' }}
          >
            ログイン画面へ
          </Link>
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
        <div className="tag">{preview.invitedByName} さんからの招待</div>

        <div className="app-note">
          <p style={{ margin: 0 }}>
            <strong>{preview.organizationName}</strong> に
            {preview.role === 'admin' ? '組織管理者' : 'メンバー'}
            として参加します。
          </p>
        </div>

        {token ? (
          <JoinForm token={token} email={preview.email} needsAccount={preview.needsAccount} />
        ) : null}

        {preview.needsAccount ? null : (
          <p style={{ fontSize: '.76rem', color: 'var(--ink-soft)', marginTop: '.9rem' }}>
            このメールアドレスのアカウントはすでにあります。パスワードは変わりません。
          </p>
        )}
      </div>
    </div>
  );
}
