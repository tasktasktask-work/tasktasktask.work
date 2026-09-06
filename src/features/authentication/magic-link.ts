import { pool, transaction } from '#lib/db.ts';
import { sendMagicLink } from './mail.ts';
import { clearLoginFailures, findUserByEmail, normalizeEmail } from './queries.ts';
import { createSessionRecord, type IssuedSession } from './session.ts';
import { expiresAt, hashToken, issueToken } from './token.ts';

/*
 * マジックリンク。
 *
 * メールを受け取れることを本人性の証明として使う。
 * この仕組みがあるおかげで、パスワード再設定の画面とトークンを別に作らずに済む。
 * アカウントロックの解除経路も兼ねている。
 */

/**
 * リンクを送る。
 *
 * アカウントが無くても何も知らせない。
 * 「送りました」と「そのアドレスは登録されていません」を出し分けると、
 * 誰が登録しているかを外から調べられてしまう。
 */
export async function requestMagicLink(email: string): Promise<void> {
  const user = await findUserByEmail(normalizeEmail(email));
  if (!user) {
    return;
  }

  const { token, hash } = issueToken();
  await pool.query(
    `INSERT INTO magic_link_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [user.id, hash, expiresAt()],
  );
  await sendMagicLink(user.email, token);
}

export type ConsumeResult =
  | { ok: true; userId: string; session: IssuedSession }
  | { ok: false; reason: 'invalid' | 'expired' | 'used' };

/**
 * リンクを使う。
 *
 * 検証、使用済みの記録、セッションの記録、ロックの解除を
 * ひとつのトランザクションで行う。
 * 途中で失敗したときにトークンだけ消費される状態を作らない。
 *
 * Cookie の設定はここでは行わない。呼ぶ側が setSessionCookie を呼ぶ。
 * 分けておくと、リクエストの外からこの処理を試せる。
 */
export async function consumeMagicLink(
  token: string,
  meta: { userAgent?: string | undefined; ip?: string | undefined } = {},
): Promise<ConsumeResult> {
  return transaction(async (client) => {
    const { rows } = await client.query<{
      id: string;
      user_id: string;
      expired: boolean;
      used: boolean;
    }>(
      `SELECT id, user_id,
              (expires_at <= now()) AS expired,
              (used_at IS NOT NULL) AS used
         FROM magic_link_tokens
        WHERE token_hash = $1
          FOR UPDATE`,
      [hashToken(token)],
    );

    const row = rows[0];
    if (!row) {
      return { ok: false, reason: 'invalid' };
    }
    if (row.used) {
      return { ok: false, reason: 'used' };
    }
    if (row.expired) {
      return { ok: false, reason: 'expired' };
    }

    await client.query(`UPDATE magic_link_tokens SET used_at = now() WHERE id = $1`, [row.id]);

    // メールを受け取れることが本人の証拠になっている。ここでロックを解く。
    await clearLoginFailures(row.user_id, client);
    const session = await createSessionRecord(row.user_id, meta, client);

    return { ok: true, userId: row.user_id, session };
  });
}
