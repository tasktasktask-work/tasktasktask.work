import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { formatBytes } from '#features/attachment/limits.ts';
import { organizationUsage } from '#features/attachment/queries.ts';
import { LoginScreen } from '#features/authentication/LoginScreen.tsx';
import { OrgShell } from '#features/organization/OrgShell.tsx';
import { getOrganization } from '#features/organization/queries.ts';
import { SettingsForm } from '#features/organization/SettingsForm.tsx';
import { currentScope } from '#features/organization/scope.ts';
import { listProjectLinks } from '#features/project/queries.ts';

export const metadata: Metadata = { title: '組織の設定' };

/*
 * 組織の設定。
 *
 * 触れるのは組織管理者だけなので、メンバーには 404 を返す。
 * 「権限がありません」と出しても、できることは変わらない。
 */
export default async function SettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const found = await currentScope(slug);
  if (!found.ok) {
    return found.anonymous ? <LoginScreen /> : notFound();
  }
  if (!found.scope.isOrgAdmin) {
    notFound();
  }

  const [organization, links, usage] = await Promise.all([
    getOrganization(found.scope),
    listProjectLinks(found.scope),
    organizationUsage(found.scope),
  ]);

  return (
    <OrgShell
      slug={slug}
      organizationName={organization.name}
      displayName={found.user.displayName}
      scope={found.scope}
      current="settings"
      projects={links}
    >
      <div className="app-head">
        <div>
          <h2>組織の設定</h2>
          <div className="sub">変えられるのは組織管理者だけです</div>
        </div>
      </div>

      <SettingsForm slug={slug} name={organization.name} />

      <div className="app-props" style={{ maxWidth: '34rem' }}>
        <div className="row">
          <span className="k">SLUG</span>
          <span className="v">
            <code>{organization.slug}</code>
          </span>
        </div>
        <div className="row">
          <span className="k">言語</span>
          <span className="v">日本語</span>
        </div>
        <div className="row">
          <span className="k">タイムゾーン</span>
          <span className="v">{organization.timezone}</span>
        </div>
        <div className="row">
          <span className="k">メンバー</span>
          <span className="v">{organization.memberCount} 人</span>
        </div>
        {/* 上限は持たない。数えるのは、埋まりかけたことに気づくためである。
            ディスクの監視は「もう危ない」ことしか教えず、
            どの組織が食っているかは、そのとき調べ直すことになる */}
        {usage ? (
          <div className="row">
            <span className="k">添付</span>
            <span className="v">
              {formatBytes(usage.bytes)} / {usage.count} 件
            </span>
          </div>
        ) : null}
      </div>

      <div className="app-note">
        <p style={{ margin: 0 }}>
          slug は変えられません。URL
          に入っていて、外に貼られたリンクがそれを指しているためです。
          言語とタイムゾーンは、選べる値が増えたときに変えられるようにします。
        </p>
      </div>
    </OrgShell>
  );
}
