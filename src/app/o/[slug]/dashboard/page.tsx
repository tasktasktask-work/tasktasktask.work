import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LoginScreen } from '#features/authentication/LoginScreen.tsx';
import { AssignedThreadList } from '#features/dashboard/AssignedThreadList.tsx';
import { listAssignedThreads } from '#features/dashboard/queries.ts';
import { NotificationList } from '#features/notification/NotificationList.tsx';
import { dashboardPath } from '#features/notification/path.ts';
import { countUnread, listNotifications } from '#features/notification/queries.ts';
import { OrgShell } from '#features/organization/OrgShell.tsx';
import { getOrganization } from '#features/organization/queries.ts';
import { currentScope } from '#features/organization/scope.ts';
import { listProjectLinks } from '#features/project/queries.ts';

/**
 * 担当スレッドと通知。
 *
 * 「今日、自分は何をやるのか」への答えは二つある。
 * 担当している仕事と、自分に向けて誰かが言ったことである。
 * 別々の画面に置くと、片方を見落とす。
 *
 * 二枚を同時に出さず、タブで切り替える。
 * 縦に積むと、担当が20件あるだけで通知が画面の下へ落ちる。
 * 見落としはタブの脇と上帯のベルに出る未読の数で防ぐ。
 */
export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ tab?: string; done?: string }>;
}) {
  const { slug } = await params;
  const { tab, done } = await searchParams;
  const found = await currentScope(slug);
  if (!found.ok) {
    return found.anonymous ? <LoginScreen /> : notFound();
  }

  const { scope, user } = found;
  const notices = tab === 'notifications';
  const includeCompleted = done === '1';

  const [organization, links, rows, notifications, unread] = await Promise.all([
    getOrganization(scope),
    listProjectLinks(scope),
    notices ? Promise.resolve([]) : listAssignedThreads(scope, { includeCompleted }),
    notices ? listNotifications(scope) : Promise.resolve([]),
    countUnread(scope),
  ]);

  return (
    <OrgShell
      slug={slug}
      organizationName={organization.name}
      displayName={user.displayName}
      scope={scope}
      current={notices ? 'notices' : 'me'}
      projects={links}
    >
      <div className="app-head">
        <div style={{ minWidth: 0 }}>
          <h2>{notices ? '通知' : '担当スレッド'}</h2>
          <div className="sub">
            {user.displayName}
            {notices ? '' : ` / ${rows.length}件`}
          </div>
        </div>
      </div>

      <nav className="app-tabs">
        <Link href={dashboardPath(slug)} className={notices ? '' : 'on'}>
          担当スレッド
        </Link>
        <Link
          href={dashboardPath(slug, { tab: 'notifications' })}
          className={notices ? 'on' : ''}
        >
          通知{unread > 0 ? ` ${unread}` : ''}
        </Link>
      </nav>

      {notices ? (
        <NotificationList
          slug={slug}
          rows={notifications}
          unread={unread}
          timezone={scope.timezone}
        />
      ) : (
        <>
          <div className="app-filters">
            <span>終了日の近い順</span>
            <span className="sp" />
            <Link
              href={dashboardPath(slug, { done: !includeCompleted })}
              style={{ color: 'var(--ai)' }}
            >
              {includeCompleted ? '完了したものを隠す' : '完了したものも表示'}
            </Link>
          </div>

          {rows.length === 0 ? (
            <p className="app-empty">
              担当しているスレッドはありません。
              {includeCompleted ? '' : '完了したものは隠れています。'}
            </p>
          ) : (
            <AssignedThreadList slug={slug} rows={rows} />
          )}
        </>
      )}
    </OrgShell>
  );
}
