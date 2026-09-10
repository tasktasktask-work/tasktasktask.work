import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LoginScreen } from '#features/authentication/LoginScreen.tsx';
import { GanttChart } from '#features/gantt/GanttChart.tsx';
import { computeRange, ROW_LIMIT, selectRows, UNDATED_LIMIT } from '#features/gantt/layout.ts';
import { ganttData } from '#features/gantt/queries.ts';
import { OrgShell } from '#features/organization/OrgShell.tsx';
import { getOrganization } from '#features/organization/queries.ts';
import { currentScope } from '#features/organization/scope.ts';
import { ProjectTabs } from '#features/project/ProjectTabs.tsx';
import { projectPath } from '#features/project/path.ts';
import { listProjectLinks, resolveProject } from '#features/project/queries.ts';
import { threadLabel, threadPath } from '#features/thread/path.ts';
import { todayIn } from '#lib/datetime.ts';

/**
 * プロジェクト一枚ぶんのガント。
 *
 * 出すのは課題だけである。議論と質問は期間を持たないので時間軸に置けない。
 * 行は親子の階層で並べる。スレッド一覧が平らなのは探すための画面だからで、
 * こちらは計画の構造を読むための画面である。
 *
 * 期間の入っていない課題を図の下に並べるのが、この画面の要である。
 * 表示から外すと、ガントに載っていない課題があること自体に誰も気づけない。
 */
export default async function ProjectGantt({
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

  // 存在しないキーと、見えないプロジェクトを区別しない
  if (!project) {
    return notFound();
  }

  const data = await ganttData(scope, project.id);
  const selection = selectRows(data.threads);
  const today = todayIn(scope.timezone);
  const range = computeRange(selection.rows, today);

  const shell = (children: React.ReactNode) => (
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
            {project.archived ? ' / アーカイブ済み' : ''}
          </div>
        </div>
      </div>

      <ProjectTabs
        slug={slug}
        projectKey={project.key}
        current="gantt"
        canManage={project.canManage}
      />

      {children}
    </OrgShell>
  );

  // 課題そのものが無い。空の枠を二つ並べても、何をすればいいかが伝わらない
  if (data.counts.total === 0) {
    return shell(
      <p className="app-empty">
        このプロジェクトにはまだ課題がありません。
        {/* ここには立てる欄を置かない。
            期間の無い課題はガントに出ないので、立てた結果がこの画面に現れない */}
        {project.archived ? null : (
          <>
            {' '}
            <Link href={projectPath(slug, project.key)}>スレッド一覧で課題を立てる</Link>
          </>
        )}
      </p>,
    );
  }

  return shell(
    <>
      {selection.rows.length === 0 ? (
        /* 目盛りだけの空の図は、読むものが無いのに場所を取る */
        <p className="app-empty">
          まだ計画に載っている課題がありません。期間を入れると、この位置に図が出ます。
        </p>
      ) : (
        <>
          {selection.dated > selection.drawn ? (
            <p className="app-hint">
              期間ありの {selection.dated} 件のうち、{ROW_LIMIT} 件までのところを 祖先も含めて{' '}
              {selection.rows.length} 件だけ描いています。
            </p>
          ) : null}
          <GanttChart
            slug={slug}
            projectKey={project.key}
            rows={selection.rows}
            range={range}
            counts={data.counts}
          />
        </>
      )}

      <div className="p-undated">
        {/* 空なら警告の色を外す。良い状態を黄色で出すと、印の意味が薄れる */}
        <h4 className={data.counts.undated === 0 ? 'ok' : ''}>
          {data.counts.undated === 0 ? '' : '⚠ '}
          期間未設定 {data.counts.undated}件
        </h4>
        {data.counts.undated === 0 ? (
          <p className="none">動いている課題は、すべて計画に載っています。</p>
        ) : (
          <ul>
            {data.undated.map((row) => (
              <li key={row.id}>
                <span className="p-id">{threadLabel(project.key, row.number)}</span>{' '}
                <Link href={threadPath(slug, project.key, row.number)}>{row.title}</Link>{' '}
                <span className="who">{row.assigneeName ?? '担当者なし'}</span>
              </li>
            ))}
          </ul>
        )}
        {data.counts.undated > UNDATED_LIMIT ? (
          <p className="more">
            ほか {data.counts.undated - UNDATED_LIMIT} 件。
            {/* 全部並べるより、探せる場所へ送るほうが早い */}
            <Link href={projectPath(slug, project.key)}>スレッド一覧</Link>
            で絞り込んでください。
          </p>
        ) : null}
      </div>
    </>,
  );
}
