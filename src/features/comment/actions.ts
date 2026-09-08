'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { describeProblem, readIncoming } from '#features/attachment/incoming.ts';
import { prepareAttachments } from '#features/attachment/store.ts';
import { currentScope } from '#features/organization/scope.ts';
import { resolveProject } from '#features/project/queries.ts';
import { resolveThread } from '#features/thread/queries.ts';
import type { OrgScope } from '#lib/db.ts';
import { type CommentProblem, postComment, setCommentCheck } from './queries.ts';

/* ==========================================================================
   コメントの操作

   スレッドの操作と同じ構えである。
   フォームから届くのは slug とプロジェクトキーとスレッド番号だけで、
   スレッドの id はここで引き直す。

   例外はチェックボックスで、こちらはコメントの id を受け取る。
   一つのスレッドに何十個も並ぶものを番号で数え直させる意味がない。
   受け取った id は SQL の側で「そのスレッドに属し、かつ見えている」ことを
   確かめるので、他のスレッドの id を差し込んでも通らない。
   ========================================================================== */

export type CommentActionState = { error?: string; notice?: string };

const PROBLEM: Record<CommentProblem, string> = {
  forbidden: '操作する権限がありません',
  'not-found': 'そのコメントは見つかりません',
  archived: 'アーカイブ済みのスレッドには書けません',
  'project-archived': 'このプロジェクトはアーカイブされています',
  'invalid-body': '本文を入力してください',
  'no-such-check': 'そのチェックボックスは見つかりません',
};

const say = (reason: CommentProblem): string => PROBLEM[reason] ?? '操作できませんでした';

const target = z.object({
  slug: z.string().min(1),
  key: z.string().min(1),
  number: z.coerce.number().int().positive(),
});

/** slug とキーと番号から、スコープとスレッドの id を引き直す。 */
async function locate(
  slug: string,
  key: string,
  number: number,
): Promise<{ scope: OrgScope; threadId: string } | null> {
  const found = await currentScope(slug);
  if (!found.ok) {
    return null;
  }
  const project = await resolveProject(found.scope, key);
  if (!project) {
    return null;
  }
  const thread = await resolveThread(found.scope, project.id, number);
  return thread ? { scope: found.scope, threadId: thread.id } : null;
}

/**
 * 画面を引き直させる。
 *
 * コメントが付くとスレッドの updated_at は動かないが、
 * 一覧に出るコメント数は変わりうるので、両方を指しておく。
 */
function refresh(slug: string, key: string, number: number): void {
  revalidatePath(`/o/${slug}/p/${key}`);
  revalidatePath(`/o/${slug}/p/${key}/t/${number}`);
}

/* --------------------------------------------------------------------------
   投稿
   -------------------------------------------------------------------------- */

const postForm = target.extend({ body: z.string().min(1, '本文を入力してください') });

/**
 * コメントを投稿する。添付があれば同じ取引で付ける。
 *
 * 本文は空にできない（comments_body_not_blank）。
 * 画像だけを貼れるようにする案は採らなかった。
 * 緩めた先で本当に禁じたいのは「本文も添付も無いコメント」だが、
 * 添付は別のテーブルにあるので、その条件は CHECK では書けない。
 */
export async function postCommentAction(
  _prev: CommentActionState,
  form: FormData,
): Promise<CommentActionState> {
  const parsed = postForm.safeParse({
    slug: form.get('slug'),
    key: form.get('key'),
    number: form.get('number'),
    body: form.get('body'),
  });
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }
  const { slug, key, number, body } = parsed.data;

  const incoming = await readIncoming(form);
  if (!incoming.ok) {
    return { error: describeProblem(incoming.reason, incoming.filename) };
  }

  const here = await locate(slug, key, number);
  if (!here) {
    return { error: '操作する権限がありません' };
  }

  // 作り直しは取引の外で行う。読み直して書き出すのに数秒かかる
  const prepared = await prepareAttachments(here.scope.organizationId, incoming.files);
  if (!prepared.ok) {
    return { error: describeProblem(prepared.reason, prepared.filename) };
  }

  const result = await postComment(here.scope, here.threadId, body, prepared.prepared);
  if (!result.ok) {
    return { error: say(result.reason) };
  }

  refresh(slug, key, number);
  return { notice: '投稿しました' };
}

/* --------------------------------------------------------------------------
   チェックボックス
   -------------------------------------------------------------------------- */

const checkInput = target.extend({
  commentId: z.uuid(),
  position: z.number().int().min(0),
  checked: z.boolean(),
});

export type CheckInput = z.infer<typeof checkInput>;

/**
 * コメントの中のチェックボックスを入れる、あるいは外す。
 *
 * フォームではなく、押した瞬間に呼ばれる。
 * 「保存」を押させると、押し忘れたぶんが消える。
 */
export async function setCommentCheckAction(input: CheckInput): Promise<CommentActionState> {
  const parsed = checkInput.safeParse(input);
  if (!parsed.success) {
    return { error: 'チェックの指定が不正です' };
  }
  const { slug, key, number, commentId, position, checked } = parsed.data;

  const here = await locate(slug, key, number);
  if (!here) {
    return { error: '操作する権限がありません' };
  }

  const result = await setCommentCheck(here.scope, commentId, position, checked);
  if (!result.ok) {
    return { error: say(result.reason) };
  }

  refresh(slug, key, number);
  return {};
}
