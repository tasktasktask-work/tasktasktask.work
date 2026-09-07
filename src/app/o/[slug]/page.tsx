import { notFound } from 'next/navigation';
import { LoginScreen } from '#features/authentication/LoginScreen.tsx';
import { OrgShell } from '#features/organization/OrgShell.tsx';
import { getOrganization } from '#features/organization/queries.ts';
import { currentScope } from '#features/organization/scope.ts';

/**
 * 組織に入って最初に見る画面。
 *
 * ここにはプロジェクトの一覧が並ぶ。
 * プロジェクトの機能を実装するまでは、組織に入れたことだけを示す。
 */
export default async function OrganizationHome({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const found = await currentScope(slug);
  if (!found.ok) {
    return found.anonymous ? <LoginScreen /> : notFound();
  }

  const organization = await getOrganization(found.scope);

  return (
    <OrgShell
      slug={slug}
      organizationName={organization.name}
      displayName={found.user.displayName}
      isOrgAdmin={found.scope.isOrgAdmin}
      current="projects"
    >
      <div className="app-head">
        <div>
          <h2>プロジェクト</h2>
          <div className="sub">
            {organization.name} / メンバー {organization.memberCount} 人
          </div>
        </div>
      </div>

      <p className="app-empty">プロジェクトの画面はこれから作ります。</p>
    </OrgShell>
  );
}
