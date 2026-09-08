import { z } from 'zod';
import { pool, transaction, visibleProjectIds } from '#lib/db.ts';
import { env } from '#lib/env.ts';
import { MailFailure, type MailSender, mailSender } from '#lib/mail.ts';
import { many } from '#lib/row.ts';
import { composeNotificationMail, type PendingNotification } from './mail.ts';
import { notificationKind } from './queries.ts';

/* ==========================================================================
   通知メールを送る

   行を作るのと送るのは別の仕事である。
   コメントを書いた人のリクエストの中で SMTP を待つわけにいかない。
   相手が詰まれば、投稿の押しボタンも詰まる。

   そこで行だけ先に積み、ここが後から拾う。
   emailed_at と notifications_pending_email は、そのために置いてある。

   一巡ぶんを関数にしてある。ループは間隔を計るだけの殻で、判断を持たない。
   持たせると、確かめるのに一分待つ仕掛けになる。

   仕様は docs/features/notification/index.html にある。
   ========================================================================== */

/** 巡回の間隔。まとめる幅でもある。短くすると通が増え、長くすると届くのが遅れる。 */
export const POLL_INTERVAL_MS = 60_000;

/** 一巡で相手にする宛先の数。あふれた分は次の巡回が拾う。 */
export const RECIPIENTS_PER_PASS = 50;

/**
 * 諦めるまでの試行回数。
 *
 * 一分ごとなので、一時間ぶんにあたる。
 * 数回で諦めると、Cloudflare 側が数分止まっただけで、
 * その間の通知がまとめて捨てられる。
 * 一時間で復旧しない SMTP は、諦めたことより先に気づくべき事態である。
 */
export const MAX_ATTEMPTS = 60;

export type DeliveryReport = {
  /** 送らないと決めた行。読まれた、切っている、見えなくなった、消された。 */
  readonly settled: number;
  readonly sent: number;
  /** 送れなかったが、次の巡回でもう一度試す行。 */
  readonly retrying: number;
  /** 諦めた行。宛先が無いか、試行が上限に達した。 */
  readonly gaveUp: number;
};

/* --------------------------------------------------------------------------
   送らないと決める

   ここを飛ばすと、送らない行が索引に残り続ける。
   拾う順は古い順なので、居座った行が先頭を占め、
   新しい通知がいつまでも順番待ちになる。
   -------------------------------------------------------------------------- */

/**
 * メールの要らなくなった行に、決着を付ける。
 *
 * email_gave_up_at は「送らないことにした時刻」である。
 * ここで畳んだ行は email_attempts が 0 のままなので、
 * 送ろうとして駄目だった行とは、あとから数え分けられる。
 *
 * 見えなくなったプロジェクトの行もここで落ちる。
 * 行を作るときにも絞っているが、作ってから送るまでのあいだにも権限は動く。
 * メールは取り消せないので、ここが最後の砦になる。
 */
async function settleUnneeded(): Promise<number> {
  const result = await pool.query(
    `UPDATE notifications n
        SET email_gave_up_at = now()
       FROM users u, threads t
      WHERE n.emailed_at IS NULL
        AND n.email_gave_up_at IS NULL
        AND u.id = n.user_id
        AND t.id = n.thread_id
        AND (
             -- アプリで先に読まれた。一分後に届くのは、二度鳴っているのと同じ
             n.read_at IS NOT NULL
             -- 本人がメール通知を切っている
             OR NOT u.email_notifications_enabled
             OR u.deleted_at IS NOT NULL
             -- 飛ぶ先が消えている
             OR t.deleted_at IS NOT NULL
             -- 見えなくなった。本文にはスレッドのタイトルが入る
             OR t.project_id NOT IN (${visibleProjectIds('n.organization_id', 'n.user_id')})
        )`,
  );
  return result.rowCount ?? 0;
}

/* --------------------------------------------------------------------------
   掴む
   -------------------------------------------------------------------------- */

const pendingRow = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  email: z.string(),
  organizationName: z.string(),
  slug: z.string(),
  kind: notificationKind,
  actorName: z.string().nullable(),
  projectKey: z.string(),
  number: z.number().int(),
  title: z.string(),
  commentId: z.uuid().nullable(),
  commentBody: z.string().nullable(),
  attempts: z.number().int(),
});

type PendingRow = z.infer<typeof pendingRow>;

/**
 * 送る行を掴み、試行の回数を先に増やす。
 *
 * 送ってから増やす形も取れるが、送信の途中でプロセスが落ちる束は
 * 回数が永久に 0 のまま、起動のたびに同じ場所で落ち続ける。
 * 先に増やしておけば、そういう束もいずれ上限に達して外れる。
 * 送れた行には emailed_at が入るので、増えた回数は
 * 「何回目で届いたか」として残る。
 *
 * 取引は掴むところで閉じる。SMTP の応答をロックを握ったまま待つと、
 * 相手が詰まっているあいだ、その行に触れる問い合わせが並ぶ。
 */
async function claim(limit: number): Promise<PendingRow[]> {
  return transaction(async (client) => {
    const claimed = await client.query<{ id: string }>(
      `WITH targets AS (
         SELECT user_id
           FROM notifications
          WHERE emailed_at IS NULL AND email_gave_up_at IS NULL
          GROUP BY user_id
          -- 古い順。ここで打ち切ると、下のほうの人が永久に順番待ちになる
          ORDER BY min(created_at)
          LIMIT $1
       ),
       picked AS (
         SELECT n.id
           FROM notifications n
          WHERE n.emailed_at IS NULL
            AND n.email_gave_up_at IS NULL
            AND n.user_id IN (SELECT user_id FROM targets)
          ORDER BY n.created_at
            FOR UPDATE SKIP LOCKED
       )
       UPDATE notifications n
          SET email_attempts = n.email_attempts + 1
         FROM picked
        WHERE n.id = picked.id
       RETURNING n.id`,
      [limit],
    );

    const ids = claimed.rows.map((row) => row.id);
    if (ids.length === 0) {
      return [];
    }

    const detail = await client.query(
      `SELECT n.id,
              n.user_id                AS "userId",
              u.email,
              o.name                   AS "organizationName",
              o.slug,
              n.kind,
              a.display_name           AS "actorName",
              p.key                    AS "projectKey",
              t.number,
              t.title,
              n.comment_id             AS "commentId",
              -- 消されたコメントは引用しない。消えた文章を配り直さない
              c.body                   AS "commentBody",
              n.email_attempts         AS attempts
         FROM notifications n
         JOIN users u         ON u.id = n.user_id
         JOIN organizations o ON o.id = n.organization_id
         JOIN threads t       ON t.id = n.thread_id
         JOIN projects p      ON p.id = t.project_id
         LEFT JOIN users a    ON a.id = n.actor_user_id
         LEFT JOIN comments c ON c.id = n.comment_id AND c.deleted_at IS NULL
        WHERE n.id = ANY($1::uuid[])
        ORDER BY n.user_id, n.created_at`,
      [ids],
    );

    return many(pendingRow, detail, 'claim');
  });
}

/* --------------------------------------------------------------------------
   一巡
   -------------------------------------------------------------------------- */

function toPending(row: PendingRow): PendingNotification {
  return {
    id: row.id,
    kind: row.kind,
    organizationName: row.organizationName,
    slug: row.slug,
    projectKey: row.projectKey,
    number: row.number,
    title: row.title,
    actorName: row.actorName,
    commentId: row.commentId,
    commentBody: row.commentBody,
  };
}

async function markSent(ids: string[]): Promise<void> {
  await pool.query(`UPDATE notifications SET emailed_at = now() WHERE id = ANY($1::uuid[])`, [
    ids,
  ]);
}

async function markGaveUp(ids: string[]): Promise<void> {
  await pool.query(
    `UPDATE notifications SET email_gave_up_at = now()
      WHERE id = ANY($1::uuid[]) AND emailed_at IS NULL`,
    [ids],
  );
}

/**
 * 未送信の通知を一巡ぶん送る。
 *
 * 宛先ごとに一通へまとめる。順に送るのは、50通を同時に投げて
 * 向こうから流量を絞られるより、待つほうが安いためである。
 */
export async function deliverPendingNotifications(
  sender: MailSender = mailSender,
  origin: string = env.APP_ORIGIN,
): Promise<DeliveryReport> {
  const settled = await settleUnneeded();
  const rows = await claim(RECIPIENTS_PER_PASS);

  const byUser = new Map<string, PendingRow[]>();
  for (const row of rows) {
    const found = byUser.get(row.userId);
    if (found) {
      found.push(row);
    } else {
      byUser.set(row.userId, [row]);
    }
  }

  let sent = 0;
  let retrying = 0;
  let gaveUp = 0;

  for (const group of byUser.values()) {
    const first = group[0];
    if (!first) {
      continue;
    }
    const ids = group.map((row) => row.id);

    try {
      await sender.send(composeNotificationMail(first.email, group.map(toPending), origin));
      await markSent(ids);
      sent += ids.length;
    } catch (err) {
      // 上限に達していれば、一時的な失敗でも打ち切る
      const exhausted = group.some((row) => row.attempts >= MAX_ATTEMPTS);
      const permanent = err instanceof MailFailure && err.permanent;

      if (permanent || exhausted) {
        await markGaveUp(ids);
        gaveUp += ids.length;
        console.error(
          `[mail] ${ids.length}件の通知を諦めました（${permanent ? '宛先が拒否されました' : `${MAX_ATTEMPTS}回試しました`}）`,
          err,
        );
      } else {
        retrying += ids.length;
        console.error(
          `[mail] ${ids.length}件の通知を送れませんでした。次の巡回で試します`,
          err,
        );
      }
    }
  }

  return { settled, sent, retrying, gaveUp };
}

/* --------------------------------------------------------------------------
   ループ

   間隔を計るだけの殻である。判断はすべて上の関数に置いてある。

   一巡が終わってから次の待ちを始める。等間隔で撃つと、
   SMTP が詰まっているあいだに巡回が重なり、同じ行を二度掴む。
   -------------------------------------------------------------------------- */

let running = false;

export function startNotificationMailLoop(): void {
  // 開発中は読み込み直しのたびにここへ来る。二重に回さない。
  if (running) {
    return;
  }
  running = true;

  const tick = async (): Promise<void> => {
    try {
      const report = await deliverPendingNotifications();
      if (report.sent + report.gaveUp + report.retrying > 0) {
        console.info(
          `[mail] 送信 ${report.sent} / 再試行 ${report.retrying} / 断念 ${report.gaveUp}`,
        );
      }
    } catch (err) {
      // ここで投げると次の巡回が来なくなる。止まったことにも気づけない
      console.error('[mail] 巡回に失敗しました', err);
    }
    // unref を付けて、終了を待たせない
    setTimeout(() => void tick(), POLL_INTERVAL_MS).unref();
  };

  setTimeout(() => void tick(), POLL_INTERVAL_MS).unref();
}
