import type { Route } from 'next';

/*
 * プロジェクトの画面への行き先。
 *
 * typedRoutes は、動的な区間がひとつのパスなら文字列のまま検査してくれる。
 * /o/{slug}/p/{key} のように二つ並ぶと推論が通らず、Link に渡せない。
 *
 * そこで型を当て直す。当て直すと綴りの誤りは検査されなくなるので、
 * 組み立てをこの一枚に閉じ込め、画面の側では文字列を書かない。
 */

export function projectPath(slug: string, key: string): Route {
  return `/o/${slug}/p/${key}` as Route;
}

export function projectMembersPath(slug: string, key: string): Route {
  return `/o/${slug}/p/${key}/members` as Route;
}

export function projectSettingsPath(slug: string, key: string): Route {
  return `/o/${slug}/p/${key}/settings` as Route;
}
