'use server';

import type { Route } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createSession, destroySession } from './cookie.ts';
import { requestMagicLink } from './magic-link.ts';
import { sendAccountLocked } from './mail.ts';
import {
  hashPassword,
  MIN_PASSWORD_LENGTH,
  verifyPassword,
  wasteTimeLikeVerifying,
} from './password.ts';
import { clearLoginFailures, findUserByEmail, isLocked, recordFailedLogin } from './queries.ts';
import { safeReturnTo } from './return-to.ts';

/*
 * ログインの入り口。
 *
 * 失敗の理由を細かく返さない。
 * 「そのアドレスは登録されていない」と「パスワードが違う」を出し分けると、
 * 誰が登録しているかを外から調べられてしまう。
 */

export type LoginState = { error?: string; notice?: string };

const credentials = z.object({
  email: z.string().min(1, 'メールアドレスを入力してください'),
  password: z.string().min(1, 'パスワードを入力してください'),
  // ログイン画面はどのURLにも現れる。認証が済んだらそこへ戻す。
  returnTo: z.string().optional(),
});

const emailOnly = z.object({
  email: z.string().min(1, 'メールアドレスを入力してください'),
});

/** 失敗時に返す文言。どの理由でも同じものを返す。 */
const FAILED = 'メールアドレスまたはパスワードが違います';

export async function loginWithPassword(
  _prev: LoginState,
  form: FormData,
): Promise<LoginState> {
  const parsed = credentials.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }

  const user = await findUserByEmail(parsed.data.email);

  // アカウントが無い場合も、ある場合と同じだけ時間をかける
  if (!user?.passwordHash) {
    await wasteTimeLikeVerifying();
    return { error: FAILED };
  }

  if (isLocked(user)) {
    return {
      error:
        'パスワードでのログインを停止しています。' +
        'ログイン用リンクを受け取ると、その場で解除されます。',
    };
  }

  const matched = await verifyPassword(user.passwordHash, parsed.data.password);
  if (!matched) {
    const lockedNow = await recordFailedLogin(user.id);
    if (lockedNow) {
      // 締め出された人が理由も出口もわからないまま止まらないようにする
      await sendAccountLocked(user.email);
    }
    return { error: FAILED };
  }

  await clearLoginFailures(user.id);
  await createSession(user.id, await requestMeta());
  /*
   * typedRoutes は行き先が既知のパスであることを求めるが、
   * ここでの戻り先は利用者から渡る値である。
   * 安全性は safeReturnTo が実行時に確かめている。
   */
  redirect(safeReturnTo(parsed.data.returnTo) as Route);
}

export async function requestMagicLinkAction(
  _prev: LoginState,
  form: FormData,
): Promise<LoginState> {
  const parsed = emailOnly.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }

  await requestMagicLink(parsed.data.email);

  // 登録の有無にかかわらず同じ文言を返す
  return {
    notice: 'ログイン用のリンクをメールで送りました。48時間のあいだ有効です。',
  };
}

export async function logout(): Promise<void> {
  await destroySession();
  // 行き先の画面がログイン画面を出す。/login へ送る必要はない。
  redirect('/');
}

/** 招待からの登録などで使う。ここでは公開だけしておく。 */
export async function hashNewPassword(plain: string): Promise<string> {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください`);
  }
  return hashPassword(plain);
}

async function requestMeta() {
  const h = await headers();
  return {
    userAgent: h.get('user-agent') ?? undefined,
    ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined,
  };
}
