import Link from 'next/link';
import { projectMembersPath, projectPath, projectSettingsPath } from './path.ts';

/*
 * プロジェクトの中の行き先。
 *
 * ガントはまだ無い。並べてから中身を作ると、押しても何も起きない札が残る。
 */
export type ProjectTab = 'threads' | 'members' | 'settings';

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
