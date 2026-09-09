import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AttachmentList } from '#features/attachment/AttachmentList.tsx';
import { listCommentAttachments, listThreadAttachments } from '#features/attachment/queries.ts';
import { ThreadAttachForm } from '#features/attachment/ThreadAttachForm.tsx';
import { LoginScreen } from '#features/authentication/LoginScreen.tsx';
import { CommentForm } from '#features/comment/CommentForm.tsx';
import { CommentList } from '#features/comment/CommentList.tsx';
import { Markdown } from '#features/comment/Markdown.tsx';
import { listComments, listMentionCandidates } from '#features/comment/queries.ts';
import { isWatching } from '#features/notification/queries.ts';
import { WatchForm } from '#features/notification/WatchForm.tsx';
import { OrgShell } from '#features/organization/OrgShell.tsx';
import { getOrganization, listMembers } from '#features/organization/queries.ts';
import { currentScope } from '#features/organization/scope.ts';
import { projectPath } from '#features/project/path.ts';
import { listProjectLinks, resolveProject } from '#features/project/queries.ts';
import { listTags, listThreadTags } from '#features/tag/queries.ts';
import { TagChip } from '#features/tag/TagChip.tsx';
import { TagPicker } from '#features/tag/TagPicker.tsx';
import { threadLabel, threadPath } from '#features/thread/path.ts';
import {
  listChildren,
  resolveThread,
  type ThreadType,
  writable,
} from '#features/thread/queries.ts';
import { ThreadChildren } from '#features/thread/ThreadChildren.tsx';
import {
  ThreadArchiveForm,
  ThreadBody,
  ThreadDeleteForm,
  ThreadTitle,
} from '#features/thread/ThreadEditForms.tsx';
import {
  AssigneeForm,
  ParentForm,
  PeriodForm,
  ProgressForm,
} from '#features/thread/ThreadProps.tsx';
import { formatDateTime, formatDay } from '#lib/datetime.ts';
import { prepare } from '#lib/markdown.ts';

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

  const [
    children,
    comments,
    candidates,
    watching,
    attachedTags,
    allTags,
    bodyFiles,
    commentFiles,
  ] = await Promise.all([
    listChildren(scope, thread.id),
    listComments(scope, thread.id),
    listMentionCandidates(scope, project.id),
    isWatching(scope, thread.id),
    listThreadTags(scope, thread.id),
    listTags(scope),
    listThreadAttachments(scope, thread.id),
    listCommentAttachments(scope, thread.id),
  ]);
  const viewer = { userId: scope.userId, isOrgAdmin: scope.isOrgAdmin };
  const label = threadLabel(project.key, thread.number);
  const canWrite = writable(thread);
  const target = { slug, projectKey: project.key, number: thread.number };

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
        <div style={{ minWidth: 0, flex: 1 }}>
          {/* 見出しの隣で直す。押すと、この位置が入力欄に入れ替わる */}
          <ThreadTitle target={target} title={thread.title} canWrite={canWrite} />
          <div className="sub">
            <span className="p-id">{label}</span> {thread.createdByName} が{' '}
            {formatDay(thread.createdAt, scope.timezone)} に作成{' '}
            {/* 印が指すのは本文だけである。タイトルを直しても付かない */}
            {thread.bodyEditedAt ? (
              <span className="app-edited">
                本文編集済み {formatDateTime(thread.bodyEditedAt, scope.timezone)}
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

      {/*
        箱は三つある。本文、コメント、右の欄である。
        本文列に残すのは読むものだけにした。
        書く操作は、対象の隣（タイトルと本文）か、右の欄（添付と子）へ移してある。
      */}
      <div className="app-detail">
        <div className="body">
          {/* 本文のチェックボックスは本文そのものに書かれている。
              コメントとは違い、押すと本文が書き換わる。
              読み表示と書き換えの欄は隣り合っている必要があるので、同じ部品が両方を出す */}
          <ThreadBody target={target} body={thread.body} canWrite={canWrite}>
            {thread.body.trim() === '' ? null : (
              <Markdown
                source={prepare(thread.body, { checked: (item) => item.checked })}
                target={
                  canWrite
                    ? { kind: 'body', slug, key: project.key, number: thread.number }
                    : undefined
                }
              />
            )}
          </ThreadBody>

          {/* 添付は本文の側の情報である。
              コメントに混ぜると、仕様書や画面の写しが流れて探せなくなる。
              足す欄だけを右へ出してある。一覧は中身を確かめるものなので、狭めない */}
          {bodyFiles.length > 0 ? (
            <>
              <h3 className="app-section">
                添付{' '}
                <span style={{ color: 'var(--ink-faint)', fontWeight: 400 }}>
                  {bodyFiles.length}件
                </span>
              </h3>

              <AttachmentList
                attachments={bodyFiles}
                slug={slug}
                target={target}
                viewerUserId={viewer.userId}
                isOrgAdmin={viewer.isOrgAdmin}
                canWrite={canWrite}
              />
            </>
          ) : null}
        </div>

        <div className="talk">
          <h3 className="app-section">
            コメント{' '}
            <span style={{ color: 'var(--ink-faint)', fontWeight: 400 }}>
              {comments.length}件
            </span>
          </h3>

          {comments.length === 0 ? (
            <p className="app-empty">まだありません。</p>
          ) : (
            <CommentList
              comments={comments}
              attachments={commentFiles}
              target={target}
              canWrite={canWrite}
              viewer={viewer}
              timezone={scope.timezone}
            />
          )}

          {canWrite ? (
            <CommentForm target={target} candidates={candidates} />
          ) : (
            <p className="app-hint">
              アーカイブされているので、新しいコメントは書けません。
              すでにあるコメントは読めます。
            </p>
          )}

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

          {/* 畳んだあとにしか消せない。押せない押しボタンを見せて断るより、出さない。
              deleteThread はプロジェクト側のアーカイブを見ないので、
              畳んだプロジェクトの中でも、畳んだスレッドは消せる */}
          {scope.isOrgAdmin && thread.archived ? (
            <>
              <h3 className="app-section">削除</h3>
              <ThreadDeleteForm target={target} label={label} title={thread.title} />
            </>
          ) : null}
        </div>

        <aside className="app-aside">
          <div className="app-props">
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

            <div className="row">
              <span className="k">タグ</span>
              <span className="v">
                {canWrite ? (
                  <TagPicker target={target} attached={attachedTags} all={allTags} />
                ) : attachedTags.length > 0 ? (
                  <span className="p-tag-pick">
                    <span className="on">
                      {attachedTags.map((tag) => (
                        <TagChip key={tag.id} name={tag.name} color={tag.color} />
                      ))}
                    </span>
                  </span>
                ) : (
                  <span style={{ fontSize: '.82rem' }}>なし</span>
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

            {/* ウォッチは自分あての設定である。畳んだスレッドでも付け外しできる */}
            <div className="row">
              <span className="k">ウォッチ</span>
              <span className="v">
                <WatchForm target={target} watching={watching} />
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
          </div>

          {/* 高さの変わらないものを上に積む。
              下の子スレッドは0件から十数件まで伸びるので、逆に置くと落とす欄の位置が動く */}
          {canWrite ? (
            <section>
              <h3>添付を足す</h3>
              <ThreadAttachForm slug={slug} projectKey={project.key} number={thread.number} />
            </section>
          ) : null}

          <ThreadChildren
            slug={slug}
            projectKey={project.key}
            parentNumber={thread.number}
            threads={children}
            canWrite={canWrite}
          />
        </aside>
      </div>
    </OrgShell>
  );
}
