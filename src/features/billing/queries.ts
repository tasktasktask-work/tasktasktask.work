import type pg from 'pg';
import { z } from 'zod';
import {
  isUniqueViolation,
  type OrgScope,
  orgAdminExists,
  orgFrozenExpr,
  pool,
  transaction,
} from '#lib/db.ts';
import { billingMode } from '#lib/env.ts';
import { many, one } from '#lib/row.ts';
import { BILLING_TIMEZONE, subtotalOf, UNIT_PRICE } from './plan.ts';

/* ==========================================================================
   課金の読み書き

   状態は列に持たない。おためし期限、免除、支払い方法、未払いの有無から
   引くたびに計算する。日次で更新する形にすると、日付が変わっても
   切り替わらない時間帯ができる。

   仕様は docs/features/billing/index.html にある。
   ========================================================================== */

export const invoiceStatus = z.enum(['pending', 'open', 'paid', 'unpaid']);
export type InvoiceStatus = z.infer<typeof invoiceStatus>;

/**
 * 組織が課金から見てどこにいるか。
 *
 * 免除は他の三つと同じ平面に無い。他を上書きする印である。
 */
export type BillingState = 'trialing' | 'active' | 'frozen' | 'exempt';

const invoiceRow = z.object({
  id: z.uuid(),
  billingMonth: z.string(),
  memberCount: z.number().int(),
  unitPrice: z.number().int(),
  subtotal: z.number().int(),
  taxAmount: z.number().int().nullable(),
  totalAmount: z.number().int().nullable(),
  status: invoiceStatus,
  invoicePdfUrl: z.string().nullable(),
  paidAt: z.date().nullable(),
  failedAt: z.date().nullable(),
});

export type InvoiceRow = z.infer<typeof invoiceRow>;

const INVOICE_COLUMNS = `bi.id,
            bi.billing_month     AS "billingMonth",
            bi.member_count      AS "memberCount",
            bi.unit_price        AS "unitPrice",
            bi.subtotal,
            bi.tax_amount        AS "taxAmount",
            bi.total_amount      AS "totalAmount",
            bi.status,
            bi.invoice_pdf_url   AS "invoicePdfUrl",
            bi.paid_at           AS "paidAt",
            bi.failed_at         AS "failedAt"`;

/* --------------------------------------------------------------------------
   画面が見るもの
   -------------------------------------------------------------------------- */

const statusRow = z.object({
  trialEndsOn: z.string(),
  billingExempt: z.boolean(),
  paymentMethodSet: z.boolean(),
  stripeCustomerId: z.string().nullable(),
  frozen: z.boolean(),
  today: z.string(),
  /** その組織にとっての今月。課金対象月と同じ形（月初の日付）で持つ。 */
  currentMonth: z.string(),
  /** 最初の課金対象月。おためし終了月の翌月。 */
  firstBillingMonth: z.string(),
  memberCount: z.number().int(),
});

export type BillingStatus = z.infer<typeof statusRow> & {
  readonly state: BillingState;
  readonly unpaid: InvoiceRow | null;
  readonly unitPrice: number;
  readonly subtotalNow: number;
};

/**
 * 支払いの画面が出すものを、ひとまとめに引く。
 *
 * 組織管理者しか開けない画面なので、ここでも管理者であることを確かめる。
 * 呼ぶ側の isOrgAdmin は信用しない。
 */
export async function getBillingStatus(scope: OrgScope): Promise<BillingStatus | null> {
  const result = await pool.query(
    `SELECT o.trial_ends_on            AS "trialEndsOn",
            o.billing_exempt           AS "billingExempt",
            (o.payment_method_set_at IS NOT NULL) AS "paymentMethodSet",
            o.stripe_customer_id       AS "stripeCustomerId",
            ${orgFrozenExpr('o')}      AS frozen,
            (now() AT TIME ZONE o.timezone)::date AS today,
            date_trunc('month', now() AT TIME ZONE $3)::date AS "currentMonth",
            (date_trunc('month', o.trial_ends_on::timestamp)
              + interval '1 month')::date AS "firstBillingMonth",
            (SELECT count(*)::int
               FROM organization_members m
              WHERE m.organization_id = o.id AND m.deleted_at IS NULL) AS "memberCount"
       FROM organizations o
      WHERE o.id = $1
        AND o.deleted_at IS NULL
        AND ${orgAdminExists('$1', '$2')}`,
    [scope.organizationId, scope.userId, BILLING_TIMEZONE],
  );

  const row = one(statusRow, result, 'getBillingStatus');
  if (!row) {
    return null;
  }

  const unpaid = await findUnpaidInvoice(scope.organizationId);
  const frozen = billingMode() === 'off' ? false : row.frozen;

  return {
    ...row,
    state: resolveState(row, frozen),
    unpaid,
    unitPrice: UNIT_PRICE,
    subtotalNow: subtotalOf(row.memberCount),
  };
}

function resolveState(row: z.infer<typeof statusRow>, frozen: boolean): BillingState {
  if (row.billingExempt) {
    return 'exempt';
  }
  if (frozen) {
    return 'frozen';
  }
  return row.trialEndsOn >= row.today ? 'trialing' : 'active';
}

/** 未払いの請求。凍結の理由になっている行。 */
export async function findUnpaidInvoice(organizationId: string): Promise<InvoiceRow | null> {
  const result = await pool.query(
    `SELECT ${INVOICE_COLUMNS}
       FROM billing_invoices bi
      WHERE bi.organization_id = $1 AND bi.status = 'unpaid'
      ORDER BY bi.billing_month
      LIMIT 1`,
    [organizationId],
  );
  return one(invoiceRow, result, 'findUnpaidInvoice');
}

export type FreezeReason =
  | { readonly kind: 'trial'; readonly trialEndsOn: string }
  | { readonly kind: 'unpaid' }
  | null;

/**
 * 凍結の理由。帯に出す一文を決めるためだけに引く。
 *
 * 組織管理者に限らない。凍結の帯はメンバー全員に出る。
 * 金額は返さない。請求の中身を見られるのは組織管理者だけである。
 */
export async function freezeReason(scope: OrgScope): Promise<FreezeReason> {
  const { rows } = await pool.query<{ trial_ends_on: string; unpaid: boolean }>(
    `SELECT o.trial_ends_on,
            EXISTS (SELECT 1 FROM billing_invoices bi
                     WHERE bi.organization_id = o.id AND bi.status = 'unpaid') AS unpaid
       FROM organizations o
      WHERE o.id = $1`,
    [scope.organizationId],
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return row.unpaid ? { kind: 'unpaid' } : { kind: 'trial', trialEndsOn: row.trial_ends_on };
}

/** 請求の記録。新しい月から並べる。 */
export async function listInvoices(scope: OrgScope): Promise<InvoiceRow[]> {
  const result = await pool.query(
    `SELECT ${INVOICE_COLUMNS}
       FROM billing_invoices bi
      WHERE bi.organization_id = $1
        AND bi.status <> 'pending'
        AND ${orgAdminExists('$1', '$2')}
      ORDER BY bi.billing_month DESC`,
    [scope.organizationId, scope.userId],
  );
  return many(invoiceRow, result, 'listInvoices');
}

const invoiceMemberRow = z.object({
  userId: z.uuid(),
  displayName: z.string(),
});

export type InvoiceMemberRow = z.infer<typeof invoiceMemberRow>;

/**
 * その請求で数えた人。当時の表示名のまま返す。
 *
 * users を結合しない。名前は焼いてあるので、辿る必要がない。
 * 辿ると、抜けたあとに改名した人の名前が明細で変わる。
 */
export async function listInvoiceMembers(
  scope: OrgScope,
  invoiceId: string,
): Promise<InvoiceMemberRow[]> {
  const result = await pool.query(
    `SELECT im.user_id      AS "userId",
            im.display_name AS "displayName"
       FROM billing_invoice_members im
       JOIN billing_invoices bi ON bi.id = im.billing_invoice_id
      WHERE im.billing_invoice_id = $3
        AND bi.organization_id = $1
        AND ${orgAdminExists('$1', '$2')}
      ORDER BY im.display_name`,
    [scope.organizationId, scope.userId, invoiceId],
  );
  return many(invoiceMemberRow, result, 'listInvoiceMembers');
}

/* --------------------------------------------------------------------------
   支払い方法
   -------------------------------------------------------------------------- */

/**
 * Stripe の顧客を結びつける。まだ支払い方法は預かっていない。
 *
 * 顧客を作るのは Checkout を始める時点である。組織を作る時点ではない。
 * おためし期間だけ使って去った組織のぶんが、Stripe 側に溜まらないようにする。
 */
export async function attachCustomer(scope: OrgScope, customerId: string): Promise<boolean> {
  try {
    const { rowCount } = await pool.query(
      `UPDATE organizations
          SET stripe_customer_id = $3
        WHERE id = $1
          AND deleted_at IS NULL
          AND stripe_customer_id IS NULL
          AND ${orgAdminExists('$1', '$2')}`,
      [scope.organizationId, scope.userId, customerId],
    );
    return rowCount === 1;
  } catch (err) {
    /*
     * 同じ顧客が別の組織に結びついている。一意索引に当たった。
     * 本物の Stripe では起きないが、ここで投げると
     * 支払いの画面が 500 を返し、凍結を解く道が塞がる。
     */
    if (isUniqueViolation(err)) {
      return false;
    }
    throw err;
  }
}

/** 支払い方法を預かった。ここで凍結が解ける（未払いが無ければ）。 */
export async function markPaymentMethodSet(scope: OrgScope): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE organizations
        SET payment_method_set_at = now()
      WHERE id = $1
        AND deleted_at IS NULL
        AND ${orgAdminExists('$1', '$2')}`,
    [scope.organizationId, scope.userId],
  );
  return rowCount === 1;
}

/* --------------------------------------------------------------------------
   課金人数

   その月に一度でも在籍した人を、ひとり1と数える。
   月の途中で入った人も、抜けた人も、その月はまるごと数える。
   -------------------------------------------------------------------------- */

/**
 * 対象月の課金人数と、その顔ぶれ。
 *
 * DISTINCT が要る。抜けてから招待し直された人は所属の行を二つ持つ
 * （acceptInvitation が畳んだ行を起こさず、新しい行を足すため）。
 *
 * 月の境目は組織のタイムゾーンで作る。相手の一日がいつ始まるかの話である。
 */
export async function countBillableMembers(
  client: pg.PoolClient,
  organizationId: string,
  billingMonth: string,
  timezone: string,
): Promise<{ userId: string; displayName: string }[]> {
  const { rows } = await client.query<{ userId: string; displayName: string }>(
    `SELECT DISTINCT ON (m.user_id)
            m.user_id      AS "userId",
            u.display_name AS "displayName"
       FROM organization_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = $1
        AND m.created_at < (($2::date + interval '1 month')::timestamp AT TIME ZONE $3)
        AND (m.deleted_at IS NULL
             OR m.deleted_at >= ($2::date::timestamp AT TIME ZONE $3))
      ORDER BY m.user_id, m.created_at`,
    [organizationId, billingMonth, timezone],
  );
  return rows;
}

/* --------------------------------------------------------------------------
   月次の請求
   -------------------------------------------------------------------------- */

export type BillableOrganization = {
  readonly id: string;
  readonly name: string;
  readonly timezone: string;
  readonly stripeCustomerId: string;
};

/**
 * その月を請求する組織を選ぶ。
 *
 * 凍結の判定は請求日の一点で行う。ここが「その一点」である。
 * 免除でなく、支払い方法があり、未払いが無いこと。
 * 月の前半に凍結していたかどうかは見ない。
 *
 * 最後の条件が冪等性を担う。二度目の巡回では 0 件になる。
 */
export async function listOrganizationsToBill(
  client: pg.PoolClient,
  billingMonth: string,
): Promise<BillableOrganization[]> {
  const { rows } = await client.query<BillableOrganization>(
    `SELECT o.id,
            o.name,
            o.timezone,
            o.stripe_customer_id AS "stripeCustomerId"
       FROM organizations o
      WHERE o.deleted_at IS NULL
        AND o.billing_exempt = false
        AND o.payment_method_set_at IS NOT NULL
        AND o.stripe_customer_id IS NOT NULL
        AND o.trial_ends_on < $1::date
        AND NOT EXISTS (SELECT 1 FROM billing_invoices u
                         WHERE u.organization_id = o.id AND u.status = 'unpaid')
        AND NOT EXISTS (SELECT 1 FROM billing_invoices e
                         WHERE e.organization_id = o.id AND e.billing_month = $1::date)
      ORDER BY o.created_at`,
    [billingMonth],
  );
  return rows;
}

const diagnosisRow = z.object({
  slug: z.string(),
  reason: z.string().nullable(),
  memberCount: z.number().int(),
});

export type BillingDiagnosis = z.infer<typeof diagnosisRow>;

/**
 * その月に請求が立たなかった組織と、その理由。
 *
 * 選ぶ側の条件を否定形で並べ直したものである。
 * 条件を二箇所に書くことになるが、揃っていなくても請求は狂わない。
 * ここが答えるのは「なぜ立たなかったか」だけで、立てる判断はしない。
 *
 * 最後の一つ（在籍が0人）は listOrganizationsToBill の外にある。
 * 人数を数えるのは行を作る直前なので、選ぶ段では分からない。
 */
export async function diagnoseBilling(billingMonth: string): Promise<BillingDiagnosis[]> {
  const result = await pool.query(
    `SELECT o.slug,
            (SELECT count(DISTINCT m.user_id)::int
               FROM organization_members m
              WHERE m.organization_id = o.id
                AND m.created_at < (($1::date + interval '1 month')::timestamp AT TIME ZONE o.timezone)
                AND (m.deleted_at IS NULL
                     OR m.deleted_at >= ($1::date::timestamp AT TIME ZONE o.timezone))
            ) AS "memberCount",
            CASE
              WHEN o.deleted_at IS NOT NULL          THEN '組織が削除されている'
              WHEN o.billing_exempt                  THEN '課金免除'
              WHEN o.payment_method_set_at IS NULL   THEN '支払い方法が未登録'
              WHEN o.stripe_customer_id IS NULL      THEN '決済代行の顧客が無い'
              WHEN o.trial_ends_on >= $1::date       THEN 'おためし期間がこの月に及んでいる'
              WHEN EXISTS (SELECT 1 FROM billing_invoices u
                            WHERE u.organization_id = o.id AND u.status = 'unpaid')
                                                     THEN '未払いを抱えている'
              WHEN EXISTS (SELECT 1 FROM billing_invoices e
                            WHERE e.organization_id = o.id AND e.billing_month = $1::date)
                                                     THEN 'この月は請求済み'
              WHEN NOT EXISTS (SELECT 1
                                 FROM organization_members m
                                WHERE m.organization_id = o.id
                                  AND m.created_at < (($1::date + interval '1 month')::timestamp
                                                       AT TIME ZONE o.timezone)
                                  AND (m.deleted_at IS NULL
                                       OR m.deleted_at >= ($1::date::timestamp AT TIME ZONE o.timezone)))
                                                     THEN 'この月に在籍した人がいない'
              ELSE NULL
            END AS reason
       FROM organizations o
      ORDER BY o.slug`,
    [billingMonth],
  );
  return many(diagnosisRow, result, 'diagnoseBilling');
}

/**
 * 請求の行と、その内訳を作る。まだ Stripe には載せない。
 *
 * 行だけできて Stripe の請求書が無い状態が pending である。
 * ここで落ちても次の巡回が拾えるように、二段に分けてある。
 *
 * 一意索引に当たったら、別の巡回が先に作ったということなので、黙って戻る。
 */
export async function createPendingInvoice(
  org: BillableOrganization,
  billingMonth: string,
): Promise<string | null> {
  return transaction(async (client) => {
    const members = await countBillableMembers(client, org.id, billingMonth, org.timezone);
    if (members.length === 0) {
      // 在籍が一人も無い月は請求しない。最後の組織管理者は外せないので、通常は起きない
      return null;
    }

    const created = await client.query<{ id: string }>(
      `INSERT INTO billing_invoices
         (organization_id, billing_month, member_count, unit_price, subtotal)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (organization_id, billing_month) DO NOTHING
       RETURNING id`,
      [org.id, billingMonth, members.length, UNIT_PRICE, subtotalOf(members.length)],
    );

    const invoiceId = created.rows[0]?.id;
    if (!invoiceId) {
      return null;
    }

    for (const member of members) {
      await client.query(
        `INSERT INTO billing_invoice_members (billing_invoice_id, user_id, display_name)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [invoiceId, member.userId, member.displayName],
      );
    }

    return invoiceId;
  });
}

const pendingRow = z.object({
  id: z.uuid(),
  organizationId: z.uuid(),
  organizationName: z.string(),
  stripeCustomerId: z.string(),
  billingMonth: z.string(),
  memberCount: z.number().int(),
  subtotal: z.number().int(),
});

export type PendingInvoice = z.infer<typeof pendingRow>;

/** Stripe に載せ切れていない請求。落ちたあとの拾い直しもここを通る。 */
export async function listPendingInvoices(limit: number): Promise<PendingInvoice[]> {
  const result = await pool.query(
    `SELECT bi.id,
            bi.organization_id   AS "organizationId",
            o.name               AS "organizationName",
            o.stripe_customer_id AS "stripeCustomerId",
            bi.billing_month     AS "billingMonth",
            bi.member_count      AS "memberCount",
            bi.subtotal
       FROM billing_invoices bi
       JOIN organizations o ON o.id = bi.organization_id
      WHERE bi.status = 'pending'
        AND o.stripe_customer_id IS NOT NULL
      ORDER BY bi.created_at
      LIMIT $1`,
    [limit],
  );
  return many(pendingRow, result, 'listPendingInvoices');
}

/** Stripe に載って確定した。 */
export async function markInvoiceOpen(
  invoiceId: string,
  stripe: { id: string; pdfUrl: string | null; tax: number | null; total: number | null },
): Promise<void> {
  await pool.query(
    `UPDATE billing_invoices
        SET status = 'open',
            stripe_invoice_id = $2,
            invoice_pdf_url = $3,
            tax_amount = $4,
            total_amount = $5
      WHERE id = $1 AND status = 'pending'`,
    [invoiceId, stripe.id, stripe.pdfUrl, stripe.tax, stripe.total],
  );
}

/**
 * 入金した。Webhook から呼ぶ。
 *
 * すでに paid なら何も起きない。同じ通知が二度届いても結果は変わらない。
 */
export async function markInvoicePaid(stripeInvoiceId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE billing_invoices
        SET status = 'paid', paid_at = now()
      WHERE stripe_invoice_id = $1
        AND status <> 'paid'`,
    [stripeInvoiceId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * 決済に失敗した。この行が残っているあいだ、その組織は凍結される。
 *
 * 戻り値は「いま状態が変わったか」である。
 * Stripe は同じ通知を何度も送りうるので、知らせるメールはこれを見て出す。
 */
export async function markInvoiceUnpaid(
  stripeInvoiceId: string,
): Promise<{ changed: boolean; organizationId: string | null }> {
  const { rows } = await pool.query<{ organization_id: string }>(
    `UPDATE billing_invoices
        SET status = 'unpaid', failed_at = now()
      WHERE stripe_invoice_id = $1
        AND status = 'open'
    RETURNING organization_id`,
    [stripeInvoiceId],
  );
  const organizationId = rows[0]?.organization_id ?? null;
  return { changed: organizationId !== null, organizationId };
}

/** 未払いの Stripe 請求書 id。再決済のために引く。 */
export async function unpaidStripeInvoiceId(scope: OrgScope): Promise<string | null> {
  const { rows } = await pool.query<{ stripe_invoice_id: string | null }>(
    `SELECT bi.stripe_invoice_id
       FROM billing_invoices bi
      WHERE bi.organization_id = $1
        AND bi.status = 'unpaid'
        AND ${orgAdminExists('$1', '$2')}
      ORDER BY bi.billing_month
      LIMIT 1`,
    [scope.organizationId, scope.userId],
  );
  return rows[0]?.stripe_invoice_id ?? null;
}
