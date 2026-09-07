import Link from 'next/link';
import type { ReactNode } from 'react';
import { logout } from '#features/authentication/actions.ts';
import { projectPath } from '#features/project/path.ts';

/*
 * 組織の中の画面に共通する枠。
 *
 * layout.tsx にしていないのは、スコープを二度引かないためである。
 * layout とページは並んで動くので、layout 側でも所属を確かめると
 * 同じ問い合わせが毎回二回走る。
 * ページはどのみちスコープを組み立てるので、その結果をここへ渡す。
 */

export type ShellNav = 'projects' | 'members' | 'settings' | 'project';

/** 左帯に並べるプロジェクト。畳んだものは出さない。 */
export type ShellProject = { key: string; name: string };

export function OrgShell({
  slug,
  organizationName,
  displayName,
  isOrgAdmin,
  current,
  projects,
  currentProjectKey,
  children,
}: {
  slug: string;
  organizationName: string;
  displayName: string;
  isOrgAdmin: boolean;
  current: ShellNav;
  projects: ShellProject[];
  currentProjectKey?: string;
  children: ReactNode;
}) {
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
          <h5>組織</h5>
          <Link href={`/o/${slug}/members`} className={current === 'members' ? 'on' : ''}>
            メンバー
          </Link>
          {isOrgAdmin ? (
            <Link href={`/o/${slug}/settings`} className={current === 'settings' ? 'on' : ''}>
              設定
            </Link>
          ) : null}
        </nav>

        <div className="app-main">{children}</div>
      </div>
    </div>
  );
}
