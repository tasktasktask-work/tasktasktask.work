import Link from 'next/link';
import { projectGanttPath } from '#features/gantt/path.ts';
import { projectMembersPath, projectPath, projectSettingsPath } from './path.ts';

/*
 * プロジェクトの中の行き先。
 *
 * ガントはプロジェクトが見える人全員に出す。読み取り専用なので、
 * 権限で隠す理由がない。後ろの二つは管理できる人にだけ出す。
 */
export type ProjectTab = 'threads' | 'gantt' | 'members' | 'settings';

export function ProjectTabs({
  slug,
  projectKey,
  current,
  canManage,
}: {
  slug: string;
  projectKey: string;
  current: ProjectTab;
  canManage: boolean;
}) {
  return (
    <div className="app-tabs">
      <Link href={projectPath(slug, projectKey)} className={current === 'threads' ? 'on' : ''}>
        スレッド
      </Link>
      <Link
        href={projectGanttPath(slug, projectKey)}
        className={current === 'gantt' ? 'on' : ''}
      >
        ガント
      </Link>
      {canManage ? (
        <Link
          href={projectMembersPath(slug, projectKey)}
          className={current === 'members' ? 'on' : ''}
        >
          メンバー
        </Link>
      ) : null}
      {canManage ? (
        <Link
          href={projectSettingsPath(slug, projectKey)}
          className={current === 'settings' ? 'on' : ''}
        >
          設定
        </Link>
      ) : null}
    </div>
  );
}
