import { notFound } from 'next/navigation';
import { LoginScreen } from '#features/authentication/LoginScreen.tsx';
import { OrgShell } from '#features/organization/OrgShell.tsx';
import { getOrganization } from '#features/organization/queries.ts';
import { currentScope } from '#features/organization/scope.ts';
import { ProjectTabs } from '#features/project/ProjectTabs.tsx';
import { listProjectLinks, resolveProject } from '#features/project/queries.ts';

/**
 * プロジェクトの中身。
 *
 * ここにスレッドの一覧が並ぶ。
 * スレッドの機能を実装するまでは、プロジェクトの姿だけを出す。
 */
export default async function ProjectHome({
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

  // 存在しないキーと、見えないプロジェクトを区別しない。
  // 区別すると、キーを総当たりして非公開の存在を確かめられる。
  if (!project) {
    return notFound();
  }

  return (
    <OrgShell
      slug={slug}
      organizationName={organization.name}
      displayName={user.displayName}
      isOrgAdmin={scope.isOrgAdmin}
      current="project"
      currentProjectKey={project.key}
      projects={links}
    >
      <div className="app-head">
        <div>
          <h2>{project.name}</h2>
          <div className="sub">
            {project.key} / {project.visibility === 'public' ? '公開' : '非公開'}
            {project.archived ? ' / アーカイブ済み' : ''} /{' '}
            {project.kadai + project.giron + project.shitsumon}件
          </div>
        </div>
      </div>

      <ProjectTabs
        slug={slug}
        projectKey={project.key}
        current="threads"
        canManage={project.canManage}
      />

      {project.description ? <p className="app-note">{project.description}</p> : null}

      {project.archived ? (
        <p className="app-note warn">
          このプロジェクトはアーカイブされています。中のスレッドは読み取り専用です。
        </p>
      ) : null}

      <p className="app-empty">スレッドの画面はこれから作ります。</p>
    </OrgShell>
  );
}
