import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LoginScreen } from '#features/authentication/LoginScreen.tsx';
import { OrgShell } from '#features/organization/OrgShell.tsx';
import { getOrganization } from '#features/organization/queries.ts';
import { currentScope } from '#features/organization/scope.ts';
import { NewProjectForm } from '#features/project/NewProjectForm.tsx';
import { projectPath } from '#features/project/path.ts';
import { listProjects } from '#features/project/queries.ts';

export const metadata: Metadata = { title: 'プロジェクト' };

/**
 * 組織に入って最初に見る画面。
 *
 * 閲覧できるプロジェクトだけが並ぶ。
 * 非公開で、メンバーでもないプロジェクトは、あることすら出ない。
 *
 * アーカイブ済みも既定で出す。
 * スレッド一覧では既定で隠しているが、こちらは数が違う。
 * 数個なら並んでいたほうが早く見つかる。
 */
export default async function OrganizationHome({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ archived?: string }>;
}) {
  const { slug } = await params;
  const found = await currentScope(slug);
  if (!found.ok) {
    return found.anonymous ? <LoginScreen /> : notFound();
  }

  const { scope, user } = found;
  const includeArchived = (await searchParams).archived !== '0';

  const [organization, projects] = await Promise.all([
    getOrganization(scope),
    listProjects(scope, { includeArchived }),
  ]);

  const living = projects.filter((project) => !project.archived);

  return (
    <OrgShell
      slug={slug}
      organizationName={organization.name}
      displayName={user.displayName}
      isOrgAdmin={scope.isOrgAdmin}
      current="projects"
      projects={living}
    >
      <div className="app-head">
        <div>
          <h2>プロジェクト</h2>
          <div className="sub">
            {organization.name} / {projects.length}件
          </div>
        </div>
      </div>

      {scope.isOrgAdmin ? <NewProjectForm slug={slug} /> : null}

      {projects.length === 0 ? (
        <p className="app-empty">
          {scope.isOrgAdmin
            ? 'まだプロジェクトがありません。上から作ってください。'
            : 'あなたが見られるプロジェクトはまだありません。組織管理者に声をかけてください。'}
        </p>
      ) : (
        <div className="app-projects">
          {projects.map((project) => (
            <Link
              className="app-project"
              data-archived={project.archived}
              href={projectPath(slug, project.key)}
              key={project.id}
            >
              <span className="k">
                {project.key}
                {project.visibility === 'private' ? (
                  <span className="flag pv">非公開</span>
                ) : null}
                {project.archived ? <span className="flag">アーカイブ済み</span> : null}
              </span>
              <p className="nm">{project.name}</p>
              {project.description ? <p className="ds">{project.description}</p> : null}
              <p className="ct">
                課題 {project.kadai} / 議論 {project.giron} / 質問 {project.shitsumon}
              </p>
            </Link>
          ))}
        </div>
      )}

      <p className="app-hint" style={{ marginTop: '1rem' }}>
        <Link href={includeArchived ? `/o/${slug}?archived=0` : `/o/${slug}`}>
          {includeArchived ? 'アーカイブ済みを隠す' : 'アーカイブ済みも表示する'}
        </Link>
      </p>
    </OrgShell>
  );
}
