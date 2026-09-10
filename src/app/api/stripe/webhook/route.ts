import { sendFrozenByPayment } from '#features/billing/mail.ts';
import { adminEmails } from '#features/billing/monthly.ts';
import { formatBillingMonth } from '#features/billing/plan.ts';
import {
  findUnpaidInvoice,
  markInvoicePaid,
  markInvoiceUnpaid,
} from '#features/billing/queries.ts';
import { gateway, type WebhookEvent } from '#features/billing/stripe.ts';
import { pool } from '#lib/db.ts';
import { env } from '#lib/env.ts';

/*
 * 決済代行からの知らせを受ける。
 *
 * このプロジェクトが外から通信を受ける、初めての口である。
 * 認証は署名だけで行う。誰でも叩ける URL なので、
 * 署名を確かめる前に何も読まないし、何も書かない。
 *
 * 受けるのは請求の成否だけである。支払い方法の登録は Checkout から
 * 戻ったその場で確かめられるので、ここには頼らない。
 *
 * 同じ知らせが二度届いても結果は変わらない。
 * 状態が変わったときだけメールを出す。
 */

export async function POST(request: Request): Promise<Response> {
  if (env.BILLING_MODE !== 'stripe') {
    return new Response('billing is not enabled', { status: 404 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return new Response('missing signature', { status: 400 });
  }

  // 署名は生の本文に対して付いている。JSON にしてからでは確かめられない
  const body = await request.text();

  let parsed: WebhookEvent;
  try {
    parsed = gateway().readWebhook(body, signature);
  } catch {
    // 署名が合わない。誰でも叩ける URL なので、ここから先へ進めない
    return new Response('bad signature', { status: 400 });
  }

  if (parsed.kind === 'paid') {
    await markInvoicePaid(parsed.stripeInvoiceId);
    return Response.json({ received: true });
  }

  if (parsed.kind === 'failed') {
    const { changed, organizationId } = await markInvoiceUnpaid(parsed.stripeInvoiceId);
    if (changed && organizationId) {
      await notifyFrozen(organizationId);
    }
    return Response.json({ received: true });
  }

  return Response.json({ received: true });
}

/**
 * 凍結したことを組織管理者へ知らせる。
 *
 * 巡回ではなくここから送る。ひとつの請求が失敗するのは一度きりなので、
 * 状態が open から unpaid へ移った瞬間だけ送れば重複しない。
 */
async function notifyFrozen(organizationId: string): Promise<void> {
  const { rows } = await pool.query<{ name: string; slug: string }>(
    `SELECT name, slug FROM organizations WHERE id = $1`,
    [organizationId],
  );
  const org = rows[0];
  if (!org) {
    return;
  }

  const invoice = await findUnpaidInvoice(organizationId);
  for (const to of await adminEmails(organizationId)) {
    await sendFrozenByPayment(
      { to, organizationName: org.name, slug: org.slug },
      {
        billingMonth: invoice ? formatBillingMonth(invoice.billingMonth) : '前月',
        amount: invoice?.totalAmount ?? null,
      },
    );
  }
}
