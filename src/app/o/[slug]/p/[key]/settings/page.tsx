import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LoginScreen } from '#features/authentication/LoginScreen.tsx';
import { OrgShell } from '#features/organization/OrgShell.tsx';
import { getOrganization } from '#features/organization/queries.ts';
import { currentScope } from '#features/organization/scope.ts';
import {
  ArchiveForm,
  DeleteForm,
  RenameProjectForm,
  VisibilityForm,
} from '#features/project/ProjectSettingsForm.tsx';
import { ProjectTabs } from '#features/project/ProjectTabs.tsx';
import { listProjectLinks, resolveProject } from '#features/project/queries.ts';

export const metadata: Metadata = { title: 'プロジェクトの設定' };

/*
 * プロジェクトの設定。プロジェクトを管理できる人が開ける。
 *
 * 名前と説明文、公開設定、アーカイブ、メンバーの出し入れ。
 * 削除だけは組織管理者に残してあり、その欄は押せる人にしか出さない。
 *
 * 画面を閉じるだけでは守りにならないので、判定は SQL の中にもある。
 */
export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ slug: string; key: string }>;
}) {
  const { slug, key } = await params;
  const found = await currentScope(slug);
  if (!found.ok) {
    return found.anonymous ? <LoginScreen /> : notFound();
  }

  const { scope, user } = found;
  const [organization, project, links] = await Promise.all([
    getOrganization(scope),
    resolveProject(scope, key),
    listProjectLinks(scope),
  ]);

  if (!project?.canManage) {
    return notFound();
  }

  return (
    <OrgShell
      slug={slug}
      organizationName={organization.name}
      displayName={user.displayName}
      scope={scope}
      current="project"
      currentProjectKey={project.key}
      projects={links}
    >
      <div className="app-head">
        <div>
          <h2>{project.name}</h2>
          <div className="sub">{project.key} / 設定</div>
        </div>
      </div>

      <ProjectTabs
        slug={slug}
        projectKey={project.key}
        current="settings"
        canManage={project.canManage}
      />

      <RenameProjectForm
        slug={slug}
        projectKey={project.key}
        name={project.name}
        description={project.description}
      />

      <h3 className="app-section">公開設定</h3>
      <VisibilityForm
        slug={slug}
        projectKey={project.key}
        visibility={project.visibility}
        memberCount={project.memberCount}
      />

      <h3 className="app-section">アーカイブ</h3>
      <ArchiveForm slug={slug} projectKey={project.key} archived={project.archived} />

      {/* 削除だけは組織管理者に残してある。押せる人にしか出さない。 */}
      {scope.isOrgAdmin ? (
        <>
          <h3 className="app-section">削除</h3>
          <DeleteForm
            slug={slug}
            projectKey={project.key}
            name={project.name}
            archived={project.archived}
          />
        </>
      ) : (
        <>
          <h3 className="app-section">削除</h3>
          <p className="app-empty">プロジェクトを削除できるのは組織管理者だけです。</p>
        </>
      )}
    </OrgShell>
  );
}
