import { z } from 'zod';
import { pool } from '#lib/db.ts';
import { one } from '#lib/row.ts';

/* ==========================================================================
   アカウントの設定

   組織のスコープを取らない数少ない場所である。
   この設定は users にあり、所属している組織すべてに効く。
   組織ごとに切り替えられる形にすると、三つの組織に居る人は
   三箇所を止めて回ることになり、一箇所を見落とせば届き続ける。

   スコープの代わりに userId だけを受け取る。
   組織の境界を越えるのではなく、そもそも組織の外側にある値である。

   置ける項目は今のところ一つしかない。
   残りは docs/issues/account-settings/ にある。
   ========================================================================== */

const account = z.object({
  displayName: z.string(),
  email: z.string(),
  emailNotificationsEnabled: z.boolean(),
});

export type Account = z.infer<typeof account>;

export async function getAccount(userId: string): Promise<Account | null> {
  const result = await pool.query(
    `SELECT display_name                 AS "displayName",
            email,
            email_notifications_enabled AS "emailNotificationsEnabled"
       FROM users
      WHERE id = $1 AND deleted_at IS NULL`,
    [userId],
  );
  return one(account, result, 'getAccount');
}

/**
 * メール通知をまとめて切り替える。
 *
 * きっかけごとの細かい設定は持たない。スイッチはひとつだけである。
 * 止める手段が無いと、煩わしく感じた人は迷惑メールとして報告する。
 * 報告が積み重なると送信ドメインの評価が下がり、
 * このシステムが認証に使っているマジックリンクまで届かなくなる。
 */
export async function setEmailNotifications(userId: string, enabled: boolean): Promise<void> {
  await pool.query(
    // updated_at は users_set_updated_at が入れる（db/functions.sql）
    `UPDATE users SET email_notifications_enabled = $2 WHERE id = $1 AND deleted_at IS NULL`,
    [userId, enabled],
  );
}
