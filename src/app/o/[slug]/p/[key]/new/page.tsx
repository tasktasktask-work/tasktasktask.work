import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LoginScreen } from '#features/authentication/LoginScreen.tsx';
import { OrgShell } from '#features/organization/OrgShell.tsx';
import { getOrganization, listMembers } from '#features/organization/queries.ts';
import { currentScope } from '#features/organization/scope.ts';
import { projectPath } from '#features/project/path.ts';
import { listProjectLinks, resolveProject } from '#features/project/queries.ts';
import { NewThreadForm } from '#features/thread/NewThreadForm.tsx';
import { threadLabel } from '#features/thread/path.ts';
import { resolveThread, type ThreadType } from '#features/thread/queries.ts';

export const metadata: Metadata = { title: 'スレッドを立てる' };

const TYPES = ['kadai', 'giron', 'shitsumon'];

/**
 * スレッドを立てる画面。
 *
 * プロジェクトを閲覧できる人なら誰でも開ける。
 * 質問を立てられない人が居ると、質問という種別を用意した意味が薄くなる。
 *
 * 種別と親は問い合わせで受け取る。
 * 「関連する課題を作成する」から来たときに、親を書き写さずに済ませるためである。
 */
export default async function NewThreadPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; key: string }>;
  searchParams: Promise<{ type?: string; parent?: string }>;
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

  if (!project) {
    return notFound();
  }
  // 畳んだプロジェクトには足せない。画面ごと閉じる。
  if (project.archived) {
    return notFound();
  }

  const defaultType: ThreadType = TYPES.includes(query.type ?? '')
    ? (query.type as ThreadType)
    : 'kadai';

  /*
   * 親として渡された番号を、ここで一度引く。
   * 引けたときだけ入力欄に入れる。存在しない番号が入った状態で開くと、
   * 書き終えてから「その番号はありません」と断ることになる。
   */
  const parentNumber = Number(query.parent);
  const parent =
    query.parent && Number.isInteger(parentNumber) && parentNumber > 0
      ? await resolveThread(scope, project.id, parentNumber)
      : null;

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
      <p style={{ fontSize: '.76rem', color: 'var(--ink-soft)', marginBottom: '.7rem' }}>
        <Link href={projectPath(slug, project.key)} style={{ color: 'var(--ai)' }}>
          {project.name}
        </Link>
        {' / '}
        スレッドを立てる
      </p>

      <div className="app-head">
        <div>
          <h2>スレッドを立てる</h2>
          <div className="sub">
            {project.key}
            {parent ? ` / ${threadLabel(project.key, parent.number)} の子として` : ''}
          </div>
        </div>
      </div>

      {parent ? (
        <p className="app-note">
          <strong>{threadLabel(project.key, parent.number)}</strong> {parent.title}{' '}
          の子として立てます。親は下の欄で変えられます。
        </p>
      ) : null}

      <NewThreadForm
        slug={slug}
        projectKey={project.key}
        members={members}
        defaultType={defaultType}
        defaultParent={parent ? threadLabel(project.key, parent.number) : ''}
      />
    </OrgShell>
  );
}
