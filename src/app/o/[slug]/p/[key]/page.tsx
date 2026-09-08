import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LoginScreen } from '#features/authentication/LoginScreen.tsx';
import { OrgShell } from '#features/organization/OrgShell.tsx';
import { getOrganization, listMembers } from '#features/organization/queries.ts';
import { currentScope } from '#features/organization/scope.ts';
import { ProjectTabs } from '#features/project/ProjectTabs.tsx';
import { listProjectLinks, resolveProject } from '#features/project/queries.ts';
import { listProjectTags } from '#features/tag/queries.ts';
import { newThreadPath } from '#features/thread/path.ts';
import { listThreads, type ThreadType } from '#features/thread/queries.ts';
import { ThreadFilters, type ThreadQuery } from '#features/thread/ThreadFilters.tsx';
import { ThreadRows } from '#features/thread/ThreadRows.tsx';

/**
 * プロジェクトの中のスレッド一覧。
 *
 * 階層を作らず平らに並べる。
 * 木にすると、絞り込んだときに「親は条件に合わないが子は合う」行の
 * 置き場所が無くなる。親と子へは行のリンクから辿る。
 *
 * 既定では完了とアーカイブ済みを隠す。
 * ただしアーカイブ済みでも、活動中の子を持つものは残す（listThreads）。
 */
export default async function ProjectThreads({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; key: string }>;
  searchParams: Promise<ThreadQuery>;
}) {
  const { slug, key } = await params;
  const found = await currentScope(slug);
  if (!found.ok) {
    return found.anonymous ? <LoginScreen /> : notFound();
  }

  const { scope, user } = found;
  const query = await searchParams;

  const [organization, project, links, members] = await Promise.all([
    getOrganization(scope),
    resolveProject(scope, key),
    listProjectLinks(scope),
    listMembers(scope),
  ]);

  // 存在しないキーと、見えないプロジェクトを区別しない。
  // 区別すると、キーを総当たりして非公開の存在を確かめられる。
  if (!project) {
    return notFound();
  }

  const type = ['kadai', 'giron', 'shitsumon'].includes(query.type ?? '')
    ? (query.type as ThreadType)
    : undefined;

  const [threads, tags] = await Promise.all([
    listThreads(scope, project.id, {
      ...(type ? { type } : {}),
      ...(query.assignee === 'none'
        ? { unassigned: true }
        : query.assignee
          ? { assigneeUserId: query.assignee }
          : {}),
      ...(query.tag ? { tagId: query.tag } : {}),
      includeCompleted: query.completed === '1',
      includeArchived: query.archived === '1',
    }),
    listProjectTags(scope, project.id),
  ]);

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
          <div className="sub">
            {project.key} / {project.visibility === 'public' ? '公開' : '非公開'}
            {project.archived ? ' / アーカイブ済み' : ''} /{' '}
            {project.kadai + project.giron + project.shitsumon}件
          </div>
        </div>
        <span style={{ flex: 1 }} />
        {/* 畳んだプロジェクトには足せない。押せない札を出しても仕方がない */}
        {project.archived ? null : (
          <Link className="app-btn" href={newThreadPath(slug, project.key)}>
            スレッドを立てる
          </Link>
        )}
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

      <ThreadFilters members={members} tags={tags} query={query} />

      {threads.length === 0 ? (
        <p className="app-empty">
          {query.type || query.assignee || query.tag
            ? 'この条件に合うスレッドはありません。'
            : 'まだスレッドがありません。決まっていない相談も、議論として立てられます。'}
        </p>
      ) : (
        <ThreadRows slug={slug} threads={threads} timezone={scope.timezone} />
      )}

      {threads.length === 200 ? (
        <p className="app-hint">200件までしか出していません。絞り込んでください。</p>
      ) : null}
    </OrgShell>
  );
}
