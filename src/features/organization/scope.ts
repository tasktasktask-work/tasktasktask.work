import { currentUser } from '#features/authentication/cookie.ts';
import type { SessionUser } from '#features/authentication/session.ts';
import type { OrgScope } from '#lib/db.ts';
import { resolveScope } from './queries.ts';

/*
 * ページと、組織のスコープの橋渡し。
 *
 * /o/{slug}/... のページは必ずここを通る。
 * 通らなければ organization_id が確定せず、その先のクエリが書けない。
 * 「条件を書き忘れたら他社のデータが混ざる」ではなく
 * 「スコープが無ければ何も引けない」という形にしてある。
 */

export type ScopeResult =
  | { readonly ok: true; readonly scope: OrgScope; readonly user: SessionUser }
  /** ログインしていない。そのURLのままログイン画面を出す。 */
  | { readonly ok: false; readonly anonymous: true }
  /** ログインはしているが、その組織には所属していない。 */
  | { readonly ok: false; readonly anonymous: false };

/**
 * ログイン中の人のスコープを組み立てる。
 *
 * 存在しない slug と、所属していない組織を区別しない。
 * 区別すると、slug を総当たりして他社の存在を確かめられる。
 * どちらも見つからなかったものとして扱い、画面は 404 を出す。
 */
export async function currentScope(slug: string): Promise<ScopeResult> {
  const user = await currentUser();
  if (!user) {
    return { ok: false, anonymous: true };
  }

  const scope = await resolveScope(user.userId, slug);
  if (!scope) {
    return { ok: false, anonymous: false };
  }

  return { ok: true, scope, user };
}
