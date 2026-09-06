import { cookies } from 'next/headers';
import { pool } from '#lib/db.ts';
import {
  createSessionRecord,
  findSessionUser,
  type IssuedSession,
  revokeSession,
  SESSION_COOKIE,
  type SessionUser,
} from './session.ts';

/*
 * セッションと Cookie の橋渡し。
 *
 * next/headers を読み込むのはこのファイルだけにしてある。
 * session.ts をリクエストの外から動かせる状態に保つためである。
 */

export async function setSessionCookie(session: IssuedSession): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: session.expiresAt,
  });
}

/** 記録と Cookie の設定をまとめて行う。 */
export async function createSession(
  userId: string,
  meta: { userAgent?: string | undefined; ip?: string | undefined } = {},
): Promise<void> {
  await setSessionCookie(await createSessionRecord(userId, meta, pool));
}

/** いま誰がログインしているか。していなければ null。 */
export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? findSessionUser(token) : null;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await revokeSession(token);
  }
  store.delete(SESSION_COOKIE);
}
