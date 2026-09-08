import type { Route } from 'next';

/*
 * ガントへの行き先。
 *
 * 動的な区間が二つ並ぶと typedRoutes の推論が通らないので、
 * プロジェクトの他の画面と同じく型を当て直す（project/path.ts と同じ理由）。
 */

export function projectGanttPath(slug: string, key: string): Route {
  return `/o/${slug}/p/${key}/gantt` as Route;
}
