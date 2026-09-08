'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { currentUser } from '#features/authentication/cookie.ts';
import { setEmailNotifications } from './queries.ts';

/*
 * アカウントの操作。
 *
 * 組織のスコープを取らない。この設定は所属している組織すべてに効く。
 * 誰の設定を変えるかは Cookie から引く。
 * フォームに書かせると、他人の通知を止める形が作れる。
 */

export type AccountActionState = { error?: string; notice?: string };

const toggle = z.object({ enabled: z.enum(['on', 'off']) });

export async function setEmailNotificationsAction(
  _prev: AccountActionState,
  form: FormData,
): Promise<AccountActionState> {
  const parsed = toggle.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }

  const user = await currentUser();
  if (!user) {
    return { error: 'ログインし直してください' };
  }

  const enabled = parsed.data.enabled === 'on';
  await setEmailNotifications(user.userId, enabled);
  revalidatePath('/me');

  return {
    notice: enabled ? '通知メールを受け取ります' : '通知メールを止めました',
  };
}
