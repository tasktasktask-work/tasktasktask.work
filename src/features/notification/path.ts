import type { Route } from 'next';

/** 担当スレッドと通知の画面。二枚のタブは問い合わせで切り替える。 */
export function dashboardPath(
  slug: string,
  options: { tab?: 'notifications'; done?: boolean } = {},
): Route {
  const query = new URLSearchParams();
  if (options.tab) {
    query.set('tab', options.tab);
  }
  if (options.done) {
    query.set('done', '1');
  }
  const tail = query.size > 0 ? `?${query}` : '';
  return `/o/${slug}/dashboard${tail}` as Route;
}
