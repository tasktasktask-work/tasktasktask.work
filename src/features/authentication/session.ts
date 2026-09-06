import type pg from 'pg';
import { z } from 'zod';
import { pool } from '#lib/db.ts';
import { one } from '#lib/row.ts';
import { hashToken, issueToken } from './token.ts';

/*
 * ログインの状態。データベース側だけを扱う。
 *
 * Cookie の読み書きは cookie.ts に分けてある。
 * next/headers を読み込むとリクエストの外から動かせなくなり、
 * ロックや期限の振る舞いを試せなくなるためである。
 *
 * 30日で切れ、アクセスによる延長はしない。
 * 毎回の書き込みが起きないことと、
 * 「30日使えば必ず再ログインになる」という予測しやすさを取った。
 */

export const SESSION_COOKIE = 'task3_session';
export const SESSION_DAYS = 30;

const sessionUser = z.object({
  userId: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  emailNotificationsEnabled: z.boolean(),
});

export type SessionUser = z.infer<typeof sessionUser>;

/*
 * セッションの作成は、データベースへの記録と Cookie の設定に分けてある。
 * ひとつにすると next/headers に依存し、リクエストの外から試せなくなる。
 */

export type IssuedSession = { token: string; expiresAt: Date };

export async function createSessionRecord(
  userId: string,
  meta: { userAgent?: string | undefined; ip?: string | undefined } = {},
  client: pg.Pool | pg.PoolClient | pg.Client = pool,
): Promise<IssuedSession> {
  const { token, hash } = issueToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await client.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, created_ip)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, hash, expires, meta.userAgent ?? null, meta.ip ?? null],
  );

  return { token, expiresAt: expires };
}

/** トークンからログイン中のユーザーを引く。Cookie は扱わない。 */
export async function findSessionUser(token: string): Promise<SessionUser | null> {
  const result = await pool.query(
    `SELECT u.id                          AS "userId",
            u.email,
            u.display_name                AS "displayName",
            u.email_notifications_enabled AS "emailNotificationsEnabled"
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND u.deleted_at IS NULL`,
    [hashToken(token)],
  );
  return one(sessionUser, result, 'findSessionUser');
}

export async function revokeSession(token: string): Promise<void> {
  await pool.query(
    `UPDATE sessions SET revoked_at = now()
      WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hashToken(token)],
  );
}
