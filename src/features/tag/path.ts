import type { Route } from 'next';

/** タグの管理画面。組織の中にあり、誰でも入れる。 */
export function tagsPath(slug: string): Route {
  return `/o/${slug}/tags` as Route;
}
