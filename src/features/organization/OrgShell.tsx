import Link from 'next/link';
import type { ReactNode } from 'react';
import { logout } from '#features/authentication/actions.ts';
import { FrozenBanner } from '#features/billing/FrozenBanner.tsx';
import { billingPath } from '#features/billing/path.ts';
import { freezeReason } from '#features/billing/queries.ts';
import { dashboardPath } from '#features/notification/path.ts';
import { countUnread } from '#features/notification/queries.ts';
import { projectPath } from '#features/project/path.ts';
import { tagsPath } from '#features/tag/path.ts';
import type { OrgScope } from '#lib/db.ts';
import { billingMode } from '#lib/env.ts';

/*
 * 組織の中の画面に共通する枠。
 *
 * layout.tsx にしていないのは、スコープを二度引かないためである。
 * layout とページは並んで動くので、layout 側でも所属を確かめると
 * 同じ問い合わせが毎回二回走る。
 * ページはどのみちスコープを組み立てるので、その結果をここへ渡す。
 */

export type ShellNav =
  | 'projects'
  | 'members'
  | 'settings'
  | 'tags'
  | 'project'
  | 'me'
  | 'notices'
  | 'billing';

/** 左帯に並べるプロジェクト。畳んだものは出さない。 */
export type ShellProject = { key: string; name: string };

export async function OrgShell({
  slug,
  organizationName,
  displayName,
  scope,
  current,
  projects,
  currentProjectKey,
  children,
}: {
  slug: string;
  organizationName: string;
  displayName: string;
  /*
   * 未読の数をここで引くために受け取る。
   * 各ページで数えて渡す形にすると、同じ三行が8つの画面に散る。
   * 一つ足し忘れた画面では、ベルだけが黙る。
   */
  scope: OrgScope;
  current: ShellNav;
  projects: ShellProject[];
  currentProjectKey?: string;
  children: ReactNode;
}) {
  const showBilling = billingMode() !== 'off';
  const unread = await countUnread(scope);
  /*
   * 凍結の帯は、すべての画面の上に出る。
   * 理由まで引くのは凍結されているときだけなので、普段は一度の問い合わせも増えない。
   */
  const reason = scope.frozen ? await freezeReason(scope) : null;

  return (
    <div className="app-frame">
      <div className="app-top">
        <Link href="/" className="app-logo" style={{ textDecoration: 'none' }}>
          <span className="m">3</span>TASK3
        </Link>
        <Link href="/" className="app-org" style={{ textDecoration: 'none', color: 'inherit' }}>
          {organizationName} <span className="slug">{slug}</span>
        </Link>
        <span className="sp" />
        <Link
          href={dashboardPath(slug, { tab: 'notifications' })}
          className="app-bell"
          aria-label={unread > 0 ? `未読の通知が${unread}件あります` : '通知'}
          style={{ textDecoration: 'none' }}
        >
          🔔{unread > 0 ? <span className="n">{unread > 99 ? '99+' : unread}</span> : null}
        </Link>
        <span className="hanko sm" aria-hidden="true">
          {[...displayName][0] ?? '?'}
        </span>
        <form action={logout}>
          <button className="app-btn ghost" type="submit">
            ログアウト
          </button>
        </form>
      </div>

      <div className="app-shell">
        <nav className="app-side">
          <h5>プロジェクト</h5>
          <Link href={`/o/${slug}`} className={current === 'projects' ? 'on' : ''}>
            一覧
          </Link>
          {projects.map((project) => (
            <Link
              key={project.key}
              href={projectPath(slug, project.key)}
              className={current === 'project' && project.key === currentProjectKey ? 'on' : ''}
            >
              <span className="k">{project.key}</span>
              {project.name}
            </Link>
          ))}
          <h5>わたし</h5>
          <Link href={dashboardPath(slug)} className={current === 'me' ? 'on' : ''}>
            担当スレッド
          </Link>
          <Link
            href={dashboardPath(slug, { tab: 'notifications' })}
            className={current === 'notices' ? 'on' : ''}
          >
            通知
          </Link>
          {/* 組織の外にある。メール通知の入り切りは users にあり、全組織に効く */}
          <Link href="/me">アカウント</Link>

          <h5>組織</h5>
          <Link href={`/o/${slug}/members`} className={current === 'members' ? 'on' : ''}>
            メンバー
          </Link>
          {/* 設定の中ではなくここに置く。設定は組織管理者だけの場所で、
              タグは誰でも作れる */}
          <Link href={tagsPath(slug)} className={current === 'tags' ? 'on' : ''}>
            タグ
          </Link>
          {scope.isOrgAdmin ? (
            <Link href={`/o/${slug}/settings`} className={current === 'settings' ? 'on' : ''}>
              設定
            </Link>
          ) : null}
          {/* 支払いに進めるのは組織管理者だけ。押せない道を見せない */}
          {scope.isOrgAdmin && showBilling ? (
            <Link href={billingPath(slug)} className={current === 'billing' ? 'on' : ''}>
              支払い
            </Link>
          ) : null}
        </nav>

        <div className="app-main">
          {scope.frozen ? (
            <FrozenBanner
              slug={slug}
              isOrgAdmin={scope.isOrgAdmin}
              reason={reason}
              onBillingPage={current === 'billing'}
            />
          ) : null}
          {children}
        </div>
      </div>
    </div>
  );
}
