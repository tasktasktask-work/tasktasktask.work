import type { Route } from 'next';

/** 支払いの画面。組織管理者だけが開ける。 */
export function billingPath(slug: string): Route {
  return `/o/${slug}/billing` as Route;
}
