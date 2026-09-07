import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LoginScreen } from '#features/authentication/LoginScreen.tsx';
import { OrgShell } from '#features/organization/OrgShell.tsx';
import { getOrganization, listMembers } from '#features/organization/queries.ts';
import { currentScope } from '#features/organization/scope.ts';
import { projectPath } from '#features/project/path.ts';
import { listProjectLinks, resolveProject } from '#features/project/queries.ts';
import { newThreadPath, threadLabel, threadPath } from '#features/thread/path.ts';
import {
  listChildren,
  resolveThread,
  type ThreadType,
  writable,
} from '#features/thread/queries.ts';
import {
  ThreadArchiveForm,
  ThreadDeleteForm,
  ThreadTextForm,
} from '#features/thread/ThreadEditForms.tsx';
import {
  AssigneeForm,
  ParentForm,
  PeriodForm,
  ProgressForm,
} from '#features/thread/ThreadProps.tsx';
import { ThreadRows } from '#features/thread/ThreadRows.tsx';
import { formatDateTime, formatDay } from '#lib/datetime.ts';

const TYPE_LABEL: Record<ThreadType, string> = {
  kadai: '課題',
  giron: '議論',
  shitsumon: '質問',
};

/**
 * スレッドの詳細。
 *
 * 本文と属性と親子がここに集まる。
 * 進捗率と期間と担当者を変えられるのは、この画面だけである。
 *
 * 畳んであるときは、書き換えの欄を消す。
 * 無効にして灰色で残すのではなく、消す。
 * 読めるが書けない状態であることを、画面の構造で示す。
 */
export default async function ThreadPage({
  params,
}: {
  params: Promise<{ slug: string; key: string; number: string }>;
}) {
  const { slug, key, number } = await params;
  const found = await currentScope(slug);
  if (!found.ok) {
    return found.anonymous ? <LoginScreen /> : notFound();
  }

  const parsed = Number(number);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return notFound();
  }

  const { scope, user } = found;
  const [organization, project, links, members] = await Promise.all([
    getOrganization(scope),
    resolveProject(scope, key),
    listProjectLinks(scope),
    listMembers(scope),
  ]);

  if (!project) {
    return notFound();
  }

  const thread = await resolveThread(scope, project.id, parsed);
  if (!thread) {
    return notFound();
  }

  const children = await listChildren(scope, thread.id);
  const label = threadLabel(project.key, thread.number);
  const canWrite = writable(thread);
  const target = { slug, projectKey: project.key, number: thread.number };

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
        {thread.parentNumber !== null ? (
          <>
            {' / '}
            <Link
              href={threadPath(slug, project.key, thread.parentNumber)}
              style={{ color: 'var(--ai)' }}
            >
              {threadLabel(project.key, thread.parentNumber)} {thread.parentTitle}
            </Link>
          </>
        ) : null}
        {' / '}
        {label}
      </p>

      <div className="app-head">
        <span className="p-type" data-type={thread.type}>
          {TYPE_LABEL[thread.type]}
        </span>
        <div style={{ minWidth: 0 }}>
          <h2>{thread.title}</h2>
          <div className="sub">
            <span className="p-id">{label}</span> {thread.createdByName} が{' '}
            {formatDay(thread.createdAt, scope.timezone)} に作成{' '}
            {thread.bodyEditedAt ? (
              <span className="app-edited">
                編集済み {formatDateTime(thread.bodyEditedAt, scope.timezone)}
              </span>
            ) : null}
          </div>
        </div>
      </div>

      {thread.projectArchived ? (
        <p className="app-note warn">
          このプロジェクトはアーカイブされています。中のスレッドは読み取り専用です。
        </p>
      ) : thread.archived ? (
        <p className="app-note warn">
          このスレッドはアーカイブされています。読み取り専用です。
          {children.length > 0 ? '子スレッドは畳まれていません。' : ''}
        </p>
      ) : null}

      {thread.overflow ? (
        <p className="app-note warn">
          期間が親スレッドの外に出ています。親の締切を延ばすのか、こちらを前倒しするのかは、
          こちらで決めてください。日付は書き換えません。
        </p>
      ) : null}

      {thread.childOverflow ? (
        <p className="app-note warn">
          子スレッドの期間が、このスレッドの期間の外に出ています。
        </p>
      ) : null}

      <div className="app-detail">
        <div>
          {thread.body.trim() === '' ? (
            <p className="app-empty">本文はまだありません。</p>
          ) : (
            <div className="app-body-md" style={{ whiteSpace: 'pre-wrap' }}>
              {thread.body}
            </div>
          )}

          {/* Q5 の動線。親を書き写さずに、ここから子を立てられる */}
          {canWrite ? (
            <p className="app-hint">
              このスレッドを親にして{' '}
              <Link
                href={newThreadPath(slug, project.key, {
                  type: 'kadai',
                  parent: thread.number,
                })}
              >
                関連する課題を作成する
              </Link>
              {' / '}
              <Link
                href={newThreadPath(slug, project.key, {
                  type: 'giron',
                  parent: thread.number,
                })}
              >
                議論
              </Link>
              {' / '}
              <Link
                href={newThreadPath(slug, project.key, {
                  type: 'shitsumon',
                  parent: thread.number,
                })}
              >
                質問
              </Link>
            </p>
          ) : null}

          <h3 className="app-section">
            子スレッド{' '}
            <span style={{ color: 'var(--ink-faint)', fontWeight: 400 }}>
              {children.length}件
            </span>
          </h3>

          {children.length === 0 ? (
            <p className="app-empty">まだありません。</p>
          ) : (
            <ThreadRows
              slug={slug}
              threads={children}
              timezone={scope.timezone}
              showMeta={false}
            />
          )}

          {canWrite ? (
            <>
              <h3 className="app-section">書き換える</h3>
              <ThreadTextForm target={target} title={thread.title} body={thread.body} />
            </>
          ) : null}

          {/* 畳んだプロジェクトの中では、畳むことも戻すこともできない */}
          {thread.projectArchived ? null : (
            <>
              <h3 className="app-section">アーカイブ</h3>
              <ThreadArchiveForm
                target={target}
                archived={thread.archived}
                childCount={thread.childCount}
              />
            </>
          )}

          {scope.isOrgAdmin ? (
            <>
              <h3 className="app-section">削除</h3>
              <ThreadDeleteForm
                target={target}
                label={label}
                title={thread.title}
                archived={thread.archived}
              />
            </>
          ) : null}
        </div>

        <aside className="app-props">
          <div className="row">
            <span className="k">進捗率</span>
            <span className="v">
              {canWrite ? (
                <ProgressForm
                  target={target}
                  progress={thread.progress}
                  binary={thread.type !== 'kadai'}
                />
              ) : thread.type === 'kadai' ? (
                <span className="p-progress" data-zero={thread.progress === 0}>
                  <span className="bar">
                    <span className="fill" style={{ width: `${thread.progress}%` }} />
                  </span>
                  <span className="num">{thread.progress}%</span>
                </span>
              ) : (
                <span className="p-oc" data-oc={thread.progress === 100 ? 'close' : 'open'}>
                  {thread.progress === 100 ? 'クローズ' : 'オープン'}
                </span>
              )}
            </span>
          </div>

          <div className="row">
            <span className="k">担当者</span>
            <span className="v">
              {canWrite ? (
                <AssigneeForm
                  target={target}
                  assigneeUserId={thread.assigneeUserId}
                  members={members}
                />
              ) : (
                <span style={{ fontSize: '.82rem' }}>{thread.assigneeName ?? '未設定'}</span>
              )}
            </span>
          </div>

          {/* 期間を持てるのは課題だけである。他の種別では欄ごと出さない */}
          {thread.type === 'kadai' ? (
            <div className="row">
              <span className="k">期間</span>
              <span className="v">
                {canWrite ? (
                  <PeriodForm
                    target={target}
                    startsOn={thread.startsOn}
                    endsOn={thread.endsOn}
                  />
                ) : (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '.78rem' }}>
                    {thread.startsOn && thread.endsOn
                      ? `${thread.startsOn} – ${thread.endsOn}`
                      : '未設定'}
                  </span>
                )}
              </span>
            </div>
          ) : null}

          <div className="row">
            <span className="k">親</span>
            <span className="v">
              {canWrite ? (
                <ParentForm target={target} parentNumber={thread.parentNumber} />
              ) : thread.parentNumber !== null ? (
                <Link
                  href={threadPath(slug, project.key, thread.parentNumber)}
                  style={{ fontSize: '.8rem', color: 'var(--ai)' }}
                >
                  {threadLabel(project.key, thread.parentNumber)}
                </Link>
              ) : (
                <span style={{ fontSize: '.82rem' }}>なし</span>
              )}
            </span>
          </div>

          <div className="row">
            <span className="k">更新</span>
            <span className="v">
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '.74rem' }}>
                {formatDateTime(thread.updatedAt, scope.timezone)}
              </span>
            </span>
          </div>
        </aside>
      </div>
    </OrgShell>
  );
}
