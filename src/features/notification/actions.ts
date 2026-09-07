'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { currentScope } from '#features/organization/scope.ts';
import { resolveProject } from '#features/project/queries.ts';
import { threadPath } from '#features/thread/path.ts';
import { resolveThread } from '#features/thread/queries.ts';
import { dashboardPath } from './path.ts';
import { markAllRead, openNotification, setWatch } from './queries.ts';

/* ==========================================================================
   通知とウォッチの操作

   通知を開く動線をリンクにしていない。
   Next.js はリンクを先読みするので、GET で既読にすると
   マウスを乗せただけで既読になる。行ごとフォームの送信にしてある。

   代わりに、新しいタブでは開けない。
   既読の取りこぼしのほうが痛いと判断した。
   ========================================================================== */

export type NotificationActionState = { error?: string; notice?: string };

/**
 * 通知を開く。既読にしてから、その通知が指す場所へ送る。
 *
 * 行き先はフォームに書かせない。通知の行から引く。
 * 書かせると、他人のスレッドを指した状態で自分の通知を既読にできる。
 */
export async function openNotificationAction(form: FormData): Promise<void> {
  const parsed = z
    .object({ slug: z.string().min(1), id: z.uuid() })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return;
  }
  const { slug, id } = parsed.data;

  const found = await currentScope(slug);
  if (!found.ok) {
    return;
  }

  const destination = await openNotification(found.scope, id);
  if (!destination) {
    // 指している先が消えたか、見えなくなった。一覧へ戻す。
    revalidatePath(dashboardPath(slug));
    redirect(dashboardPath(slug, { tab: 'notifications' }));
  }

  revalidatePath(dashboardPath(slug));
  redirect(
    threadPath(slug, destination.projectKey, destination.number, {
      ...(destination.commentId ? { commentId: destination.commentId } : {}),
    }),
  );
}

/** 未読をまとめて既読にする。対象は、いま見えているものに限る。 */
export async function markAllReadAction(form: FormData): Promise<void> {
  const parsed = z.object({ slug: z.string().min(1) }).safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return;
  }
  const { slug } = parsed.data;

  const found = await currentScope(slug);
  if (!found.ok) {
    return;
  }

  await markAllRead(found.scope);
  revalidatePath(dashboardPath(slug));
}

/* --------------------------------------------------------------------------
   ウォッチ
   -------------------------------------------------------------------------- */

const watchForm = z.object({
  slug: z.string().min(1),
  key: z.string().min(1),
  number: z.coerce.number().int().positive(),
  watching: z.enum(['on', 'off']),
});

/**
 * ウォッチを付ける、あるいは外す。
 *
 * スレッドの id はここで引き直す。フォームから届くのは
 * slug とプロジェクトキーとスレッド番号だけである。
 */
export async function setWatchAction(
  _prev: NotificationActionState,
  form: FormData,
): Promise<NotificationActionState> {
  const parsed = watchForm.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }
  const { slug, key, number, watching } = parsed.data;

  const found = await currentScope(slug);
  if (!found.ok) {
    return { error: '操作する権限がありません' };
  }
  const project = await resolveProject(found.scope, key);
  if (!project) {
    return { error: 'そのプロジェクトは見つかりません' };
  }
  const thread = await resolveThread(found.scope, project.id, number);
  if (!thread) {
    return { error: 'そのスレッドは見つかりません' };
  }

  const result = await setWatch(found.scope, thread.id, watching === 'on');
  if (!result.ok) {
    return { error: 'そのスレッドは見つかりません' };
  }

  revalidatePath(`/o/${slug}/p/${key}/t/${number}`);
  return {};
}
