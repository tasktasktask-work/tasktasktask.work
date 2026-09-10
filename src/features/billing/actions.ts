'use server';

import type { Route } from 'next';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { currentScope } from '#features/organization/scope.ts';
import { pool } from '#lib/db.ts';
import { env } from '#lib/env.ts';
import { billingPath } from './path.ts';
import {
  attachCustomer,
  getBillingStatus,
  markInvoicePaid,
  markInvoiceUnpaid,
  markPaymentMethodSet,
  unpaidStripeInvoiceId,
} from './queries.ts';
import { gateway } from './stripe.ts';

/* ==========================================================================
   支払いの操作

   どれも slug からスコープを組み立て直し、組織管理者であることを
   SQL の中で確かめてから進む。フォームの値は行き先を決めない。

   凍結中でも通る唯一の操作である。ここが通らないと、凍結が解けない。
   ========================================================================== */

export type BillingActionState = { error?: string; notice?: string };

const slugField = z.object({ slug: z.string().min(1) });

function origin(slug: string): string {
  return `${env.APP_ORIGIN}${billingPath(slug)}`;
}

/**
 * カードと住所を預ける画面へ送る。
 *
 * 顧客をここで作る。組織を作る時点では作らない。
 * おためし期間だけ使って去った組織のぶんが、Stripe 側に溜まらないようにする。
 */
export async function startCheckoutAction(
  _prev: BillingActionState,
  form: FormData,
): Promise<BillingActionState> {
  const parsed = slugField.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }
  const slug = parsed.data.slug;

  const found = await currentScope(slug);
  if (!found.ok) {
    return { error: '操作する権限がありません' };
  }

  const status = await getBillingStatus(found.scope);
  if (!status) {
    return { error: '支払いを操作できるのは組織管理者だけです' };
  }

  const { rows } = await pool.query<{ name: string; email: string }>(
    `SELECT o.name, u.email
       FROM organizations o, users u
      WHERE o.id = $1 AND u.id = $2`,
    [found.scope.organizationId, found.scope.userId],
  );
  const contact = rows[0];
  if (!contact) {
    return { error: '組織の情報を読めませんでした' };
  }

  const customerId = await gateway().ensureCustomer({
    name: contact.name,
    email: contact.email,
    existing: status.stripeCustomerId,
  });
  if (!status.stripeCustomerId && !(await attachCustomer(found.scope, customerId))) {
    return { error: '支払いの準備に失敗しました。時間をおいて試してください' };
  }

  const url = await gateway().setupUrl({
    customerId,
    successUrl: `${origin(slug)}?checkout=done`,
    cancelUrl: `${origin(slug)}?checkout=cancel`,
  });
  // 決済代行の画面へ出る。アプリの中の道ではない
  redirect(url as Route);
}

/** カードと住所を変える画面へ送る。 */
export async function openPortalAction(
  _prev: BillingActionState,
  form: FormData,
): Promise<BillingActionState> {
  const parsed = slugField.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    return { error: z.prettifyError(parsed.error) };
  }
  const slug = parsed.data.slug;

  const found = await currentScope(slug);
  if (!found.ok) {
    return { error: '操作する権限がありません' };
  }

  const status = await getBillingStatus(found.scope);
  if (!status?.stripeCustomerId) {
    return { error: 'まだ支払い方法が登録されていません' };
  }

  const url = await gateway().portalUrl({
    customerId: status.stripeCustomerId,
    returnUrl: origin(slug),
  });
  redirect(url as Route);
}

/**
 * Checkout から戻ったところ。
 *
 * 登録できたかどうかを、その場で決済代行に確かめる。
 * 最初の請求まで1ヶ月以上空くことがあるので、
 * そのあいだ使えないカードを預かったまま気づかない状態を避ける。
 *
 * 未払いが残っていれば、続けてその決済を試す。
 * 通れば凍結が解け、通らなければ凍結のままである。
 */
export async function completeCheckout(slug: string): Promise<'done' | 'unpaid' | 'failed'> {
  const found = await currentScope(slug);
  if (!found.ok) {
    return 'failed';
  }

  const status = await getBillingStatus(found.scope);
  if (!status?.stripeCustomerId) {
    return 'failed';
  }

  if (!(await gateway().confirmPaymentMethod(status.stripeCustomerId))) {
    return 'failed';
  }
  await markPaymentMethodSet(found.scope);

  const unpaid = await unpaidStripeInvoiceId(found.scope);
  if (!unpaid) {
    return 'done';
  }

  if (await gateway().payInvoice(unpaid)) {
    await markInvoicePaid(unpaid);
    return 'done';
  }
  await markInvoiceUnpaid(unpaid);
  return 'unpaid';
}
