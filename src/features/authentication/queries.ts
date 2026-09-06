import type pg from 'pg';
import { z } from 'zod';
import { pool } from '#lib/db.ts';
import { one } from '#lib/row.ts';

/*
 * 認証に必要なユーザーの読み書き。
 *
 * ここだけが users のロック関係の列に触れる。
 * 失敗回数の増減と解除が各所に散ると、片方だけ直したときに穴が開く。
 */

/** 10回連続で失敗するとロックする。時間経過では解除しない。 */
export const MAX_FAILED_LOGINS = 10;

const authUser = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  passwordHash: z.string().nullable(),
  failedLoginCount: z.number().int(),
  lockedAt: z.date().nullable(),
});

export type AuthUser = z.infer<typeof authUser>;

const SELECT_AUTH_USER = `
  SELECT id,
         email,
         display_name       AS "displayName",
         password_hash      AS "passwordHash",
         failed_login_count AS "failedLoginCount",
         locked_at          AS "lockedAt"
    FROM users
   WHERE deleted_at IS NULL`;

/** メールアドレスは小文字に揃えて保存してある。呼ぶ側で正規化する。 */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

export async function findUserByEmail(email: string): Promise<AuthUser | null> {
  const result = await pool.query(`${SELECT_AUTH_USER} AND email = $1`, [
    normalizeEmail(email),
  ]);
  return one(authUser, result, 'findUserByEmail');
}

export async function findUserById(id: string): Promise<AuthUser | null> {
  const result = await pool.query(`${SELECT_AUTH_USER} AND id = $1`, [id]);
  return one(authUser, result, 'findUserById');
}

/**
 * パスワードの入力に失敗したことを記録する。
 * 上限に達したらロックする。
 *
 * @returns この呼び出しでロックがかかったかどうか
 */
export async function recordFailedLogin(userId: string): Promise<boolean> {
  const { rows } = await pool.query<{ locked_now: boolean }>(
    `UPDATE users
        SET failed_login_count = LEAST(failed_login_count + 1, $2),
            locked_at = CASE
              WHEN locked_at IS NOT NULL      THEN locked_at
              WHEN failed_login_count + 1 >= $2 THEN now()
              ELSE NULL
            END
      WHERE id = $1 AND deleted_at IS NULL
      RETURNING (locked_at IS NOT NULL AND failed_login_count >= $2) AS locked_now`,
    [userId, MAX_FAILED_LOGINS],
  );
  return rows[0]?.locked_now ?? false;
}

/** ログインに成功したときに呼ぶ。失敗回数とロックを両方戻す。 */
export async function clearLoginFailures(
  userId: string,
  client: pg.Pool | pg.PoolClient | pg.Client = pool,
): Promise<void> {
  await client.query(
    `UPDATE users
        SET failed_login_count = 0, locked_at = NULL
      WHERE id = $1 AND (failed_login_count <> 0 OR locked_at IS NOT NULL)`,
    [userId],
  );
}

export function isLocked(user: AuthUser): boolean {
  return user.lockedAt !== null;
}
