import { z } from 'zod';
import { pool } from '#lib/db.ts';
import { billingMode } from '#lib/env.ts';
import { many } from '#lib/row.ts';
import { sendFrozenByTrial, sendTrialEndingSoon, sendTrialEndingTomorrow } from './mail.ts';
import { BILLING_TIMEZONE } from './plan.ts';
import {
  createPendingInvoice,
  listOrganizationsToBill,
  listPendingInvoices,
  markInvoiceOpen,
  markInvoicePaid,
  markInvoiceUnpaid,
} from './queries.ts';
import { gateway } from './stripe.ts';

/* ==========================================================================
   巡回

   請求の確定と、おためし終了の知らせ。
   どちらもアプリと同じプロセスの中で回す。

   cron も常駐プロセスも持たない構成なので、通知メールと同じ形にしてある
   （src/instrumentation.ts から始める）。
   動くコンテナは一つである。増やすと、同じ請求を二つの巡回が掴みうる。

   日で区切っていない。毎月1日に走らせる形にすると、その日にアプリが
   落ちていた月だけ請求が飛ぶ。対象月はいつ走らせても「前月」なので、
   月が変わってから最初の一巡が請求を立て、二巡目以降は 0 件になる。
   ========================================================================== */

const POLL_INTERVAL_MS = 5 * 60_000;

/** 一巡で Stripe に載せる本数の上限。 */
const INVOICES_PER_PASS = 20;

export type BillingReport = {
  readonly issued: number;
  readonly paid: number;
  readonly failed: number;
  /** 決済代行に載せられなかった請求。次の巡回でもう一度試す。 */
  readonly stuck: number;
  readonly notified: number;
};

/* --------------------------------------------------------------------------
   請求
   -------------------------------------------------------------------------- */

/**
 * 前月ぶんの請求を確定し、決済を試す。
 *
 * 二段に分けてある。行を作るのと、Stripe に載せるのは別の巡回でもよい。
 * 途中で落ちると status = 'pending' の行が残り、次の一巡が拾う。
 */
export async function currentBillingMonth(): Promise<string> {
  const { rows } = await pool.query<{ month: string }>(
    `SELECT (date_trunc('month', now() AT TIME ZONE $1) - interval '1 month')::date AS month`,
    [BILLING_TIMEZONE],
  );
  const month = rows[0]?.month;
  if (!month) {
    throw new Error('対象月を決められませんでした');
  }
  return month;
}

export async function runMonthlyBilling(): Promise<Omit<BillingReport, 'notified'>> {
  const billingMonth = await currentBillingMonth();

  const client = await pool.connect();
  let targets: Awaited<ReturnType<typeof listOrganizationsToBill>>;
  try {
    targets = await listOrganizationsToBill(client, billingMonth);
  } finally {
    client.release();
  }

  for (const org of targets) {
    await createPendingInvoice(org, billingMonth);
  }

  return await settlePendingInvoices();
}

/**
 * Stripe に載せ切れていない請求を片付ける。
 *
 * 確定と決済を分けて記録する。確定した時点で status を open にするので、
 * 決済の途中で落ちても、請求書が二重に作られることはない。
 */
async function settlePendingInvoices(): Promise<Omit<BillingReport, 'notified'>> {
  const pending = await listPendingInvoices(INVOICES_PER_PASS);
  let issued = 0;
  let paid = 0;
  let failed = 0;
  let stuck = 0;

  for (const invoice of pending) {
    /*
     * 一本ずつ守る。守らないと、一つの組織で起きた失敗が巡回そのものを倒し、
     * 後ろに並んでいる組織の請求が一件も立たなくなる。
     * 5分ごとに同じところで倒れ続けるので、気づくのは月末になる。
     */
    try {
      const stripe = await gateway().issueInvoice({
        customerId: invoice.stripeCustomerId,
        billingMonth: invoice.billingMonth,
        memberCount: invoice.memberCount,
        subtotal: invoice.subtotal,
        // 同じ月を二度作らせない。行の id をそのまま鍵にする
        idempotencyKey: `billing:${invoice.id}`,
      });
      await markInvoiceOpen(invoice.id, stripe);
      issued += 1;

      /*
       * 決済はここで一度だけ試す。auto_advance=false なので、
       * Stripe が次の試行を予約することはない。
       * 結果は Webhook でも届くが、どちらの道を通っても同じ行に同じ値が入る。
       */
      if (await gateway().payInvoice(stripe.id)) {
        await markInvoicePaid(stripe.id);
        paid += 1;
      } else {
        await markInvoiceUnpaid(stripe.id);
        failed += 1;
      }
    } catch (err) {
      stuck += 1;
      console.error(
        `[billing] 請求を確定できませんでした（${invoice.organizationName} / ${invoice.billingMonth} / 行 ${invoice.id}）`,
        err,
      );
    }
  }

  return { issued, paid, failed, stuck };
}

/* --------------------------------------------------------------------------
   おためし終了の知らせ

   段は単調に増えるだけなので、送信済みの記録に別のテーブルを立てずに済む。
   -------------------------------------------------------------------------- */

const noticeRow = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  trialEndsOn: z.string(),
  daysLeft: z.number().int(),
  stage: z.number().int(),
});

const STAGE_SOON = 1;
const STAGE_TOMORROW = 2;
const STAGE_FROZEN = 3;

/** 残り日数から、送るべき段を決める。 */
function stageFor(daysLeft: number): number {
  if (daysLeft <= 0) {
    return STAGE_FROZEN;
  }
  if (daysLeft <= 1) {
    return STAGE_TOMORROW;
  }
  if (daysLeft <= 7) {
    return STAGE_SOON;
  }
  return 0;
}

export async function deliverTrialNotices(): Promise<number> {
  const result = await pool.query(
    `SELECT o.id,
            o.slug,
            o.name,
            o.trial_ends_on AS "trialEndsOn",
            (o.trial_ends_on - (now() AT TIME ZONE o.timezone)::date) AS "daysLeft",
            o.billing_notice_stage AS stage
       FROM organizations o
      WHERE o.deleted_at IS NULL
        AND o.billing_exempt = false
        AND o.payment_method_set_at IS NULL
        AND o.billing_notice_stage < ${STAGE_FROZEN}
        AND o.trial_ends_on <= (now() AT TIME ZONE o.timezone)::date + 7`,
    [],
  );

  let notified = 0;
  for (const org of many(noticeRow, result, 'deliverTrialNotices')) {
    const stage = stageFor(org.daysLeft);
    if (stage <= org.stage) {
      continue;
    }

    /*
     * 段を先に上げてから送る。通知メールと同じ順である。
     * 送ってから上げると、送信のあとで落ちたときに二度届く。
     * 上げてから落ちれば、その一通が届かないだけで済む。
     */
    const claimed = await pool.query(
      `UPDATE organizations
          SET billing_notice_stage = $2
        WHERE id = $1 AND billing_notice_stage < $2`,
      [org.id, stage],
    );
    if (claimed.rowCount !== 1) {
      continue;
    }

    for (const to of await adminEmails(org.id)) {
      const target = { to, organizationName: org.name, slug: org.slug };
      if (stage === STAGE_FROZEN) {
        await sendFrozenByTrial(target);
      } else if (stage === STAGE_TOMORROW) {
        await sendTrialEndingTomorrow(target, org.trialEndsOn);
      } else {
        await sendTrialEndingSoon(target, org.trialEndsOn);
      }
      notified += 1;
    }
  }
  return notified;
}

/** 組織管理者のメールアドレス。支払いに進めるのはこの人たちだけである。 */
export async function adminEmails(organizationId: string): Promise<string[]> {
  const { rows } = await pool.query<{ email: string }>(
    `SELECT u.email
       FROM organization_members m
       JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
      WHERE m.organization_id = $1
        AND m.role = 'admin'
        AND m.deleted_at IS NULL
      ORDER BY u.email`,
    [organizationId],
  );
  return rows.map((row) => row.email);
}

/* --------------------------------------------------------------------------
   ループ
   -------------------------------------------------------------------------- */

let running = false;

export function startBillingLoop(): void {
  if (billingMode() === 'off') {
    return;
  }
  // 開発中は読み込み直しのたびにここへ来る。二重に回さない。
  if (running) {
    return;
  }
  running = true;

  const tick = async (): Promise<void> => {
    try {
      const billed = await runMonthlyBilling();
      const notified = await deliverTrialNotices();
      if (billed.issued + billed.failed + billed.stuck + notified > 0) {
        console.info(
          `[billing] 確定 ${billed.issued} / 入金 ${billed.paid} / 失敗 ${billed.failed} / 詰まり ${billed.stuck} / 知らせ ${notified}`,
        );
      }
    } catch (err) {
      // ここで投げると次の巡回が来なくなる。止まったことにも気づけない
      console.error('[billing] 巡回に失敗しました', err);
    }
    setTimeout(() => void tick(), POLL_INTERVAL_MS).unref();
  };

  setTimeout(() => void tick(), POLL_INTERVAL_MS).unref();
}
