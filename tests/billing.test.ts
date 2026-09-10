import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';

/*
 * 凍結の判定は BILLING_MODE を読む。
 * 読むのは呼ばれた時点なので、ここで立てておけば下の import に影響しない。
 */
process.env.BILLING_MODE = 'fake';

import {
  countBillableMembers,
  createPendingInvoice,
  findUnpaidInvoice,
  freezeReason,
  getBillingStatus,
  listInvoiceMembers,
  listInvoices,
  listOrganizationsToBill,
  markInvoiceOpen,
  markInvoicePaid,
  markInvoiceUnpaid,
} from '#features/billing/queries.ts';
import { resolveScope } from '#features/organization/queries.ts';
import { DEFAULT_TAG_COLOR } from '#features/tag/colors.ts';
import { createTag } from '#features/tag/queries.ts';
import { type OrgScope, pool } from '#lib/db.ts';

/*
 * 課金で取り返しがつかないのは、請求額を間違えることである。
 *
 * 確かめたいのは三つ。
 * その月に在籍した人を過不足なく数えること、
 * 凍結が書き込みだけを止めて読み取りを残すこと、
 * そして同じ月を二度請求しないことである。
 *
 * 仕様は docs/features/billing/index.html にある。
 */

const TAG = `bill-${process.pid}`;
let seq = 0;
const uniq = (): string => {
  seq += 1;
  return `${TAG}-${seq}`;
};

after(async () => {
  const like = `${TAG}-%`;
  const orgs = `SELECT id FROM organizations WHERE slug LIKE $1`;
  await pool.query(
    `DELETE FROM billing_invoice_members WHERE billing_invoice_id IN (
       SELECT id FROM billing_invoices WHERE organization_id IN (${orgs}))`,
    [like],
  );
  await pool.query(`DELETE FROM billing_invoices WHERE organization_id IN (${orgs})`, [like]);
  await pool.query(`DELETE FROM tags WHERE organization_id IN (${orgs})`, [like]);
  await pool.query(`DELETE FROM organization_members WHERE organization_id IN (${orgs})`, [
    like,
  ]);
  await pool.query(`DELETE FROM organizations WHERE slug LIKE $1`, [like]);
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`${TAG}-%@example.com`]);
  await pool.end();
});

type Org = { id: string; slug: string };

async function newOrg(
  options: { trialEndsOn?: string; paymentMethod?: boolean; exempt?: boolean } = {},
): Promise<Org> {
  const slug = uniq();
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO organizations (name, slug, trial_ends_on, billing_exempt, payment_method_set_at,
                                stripe_customer_id)
     VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE + 30), $4,
             CASE WHEN $5 THEN now() ELSE NULL END,
             CASE WHEN $5 THEN $2 ELSE NULL END)
     RETURNING id`,
    [
      slug,
      slug,
      options.trialEndsOn ?? null,
      options.exempt ?? false,
      options.paymentMethod ?? false,
    ],
  );
  const id = rows[0]?.id;
  assert.ok(id, '組織を作れませんでした');
  return { id, slug };
}

/** 在籍の行を、期間を指定して作る。 */
async function join(
  org: Org,
  name: string,
  when: { from: string; until?: string; role?: 'admin' | 'member' },
): Promise<string> {
  const email = `${uniq()}@example.com`;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id`,
    [email, name],
  );
  const userId = rows[0]?.id;
  assert.ok(userId, 'ユーザーを作れませんでした');

  await pool.query(
    `INSERT INTO organization_members (organization_id, user_id, role, created_at, deleted_at)
     VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz)`,
    [org.id, userId, when.role ?? 'member', when.from, when.until ?? null],
  );
  return userId;
}

async function scopeOf(org: Org, userId: string): Promise<OrgScope> {
  const scope = await resolveScope(userId, org.slug);
  assert.ok(scope, 'スコープを組み立てられませんでした');
  return scope;
}

async function billableNames(org: Org, month: string): Promise<string[]> {
  const client = await pool.connect();
  try {
    const members = await countBillableMembers(client, org.id, month, 'Asia/Tokyo');
    return members.map((m) => m.displayName).sort();
  } finally {
    client.release();
  }
}

/* ==========================================================================
   課金人数
   ========================================================================== */

describe('課金人数', () => {
  it('月の途中で入った人も、抜けた人も、その月はまるごと数える', async () => {
    const org = await newOrg();
    await join(org, 'A', { from: '2026-04-10T00:00:00+09:00', role: 'admin' });
    await join(org, 'B', {
      from: '2026-04-10T00:00:00+09:00',
      until: '2026-05-20T00:00:00+09:00',
    });
    await join(org, 'C', { from: '2026-05-15T00:00:00+09:00' });

    assert.deepEqual(await billableNames(org, '2026-05-01'), ['A', 'B', 'C']);
  });

  it('抜けた翌月は数えない', async () => {
    const org = await newOrg();
    await join(org, 'A', { from: '2026-04-10T00:00:00+09:00', role: 'admin' });
    await join(org, 'B', {
      from: '2026-04-10T00:00:00+09:00',
      until: '2026-05-20T00:00:00+09:00',
    });

    assert.deepEqual(await billableNames(org, '2026-06-01'), ['A']);
  });

  it('入る前の月は数えない', async () => {
    const org = await newOrg();
    await join(org, 'A', { from: '2026-04-10T00:00:00+09:00', role: 'admin' });
    await join(org, 'C', { from: '2026-05-15T00:00:00+09:00' });

    assert.deepEqual(await billableNames(org, '2026-04-01'), ['A']);
  });

  it('抜けてから戻った人を二度数えない', async () => {
    const org = await newOrg();
    const admin = await join(org, 'A', { from: '2026-04-10T00:00:00+09:00', role: 'admin' });
    // 畳んだ行を起こさず、新しい行が足される作りになっている
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id`,
      [`${uniq()}@example.com`, 'B'],
    );
    const userId = rows[0]?.id;
    assert.ok(userId);
    await pool.query(
      `INSERT INTO organization_members (organization_id, user_id, created_at, deleted_at)
       VALUES ($1, $2, $3::timestamptz, $4::timestamptz)`,
      [org.id, userId, '2026-05-02T00:00:00+09:00', '2026-05-10T00:00:00+09:00'],
    );
    await pool.query(
      `INSERT INTO organization_members (organization_id, user_id, created_at)
       VALUES ($1, $2, $3::timestamptz)`,
      [org.id, userId, '2026-05-20T00:00:00+09:00'],
    );

    assert.deepEqual(await billableNames(org, '2026-05-01'), ['A', 'B']);
    assert.ok(admin);
  });

  it('月の境目は組織のタイムゾーンで見る', async () => {
    const org = await newOrg();
    await join(org, 'A', { from: '2026-04-10T00:00:00+09:00', role: 'admin' });
    // JST では 6/1 00:30、UTC では 5/31 15:30。5月には在籍していない
    await join(org, 'D', { from: '2026-06-01T00:30:00+09:00' });

    assert.deepEqual(await billableNames(org, '2026-05-01'), ['A']);
    assert.deepEqual(await billableNames(org, '2026-06-01'), ['A', 'D']);
  });
});

/* ==========================================================================
   凍結
   ========================================================================== */

describe('凍結', () => {
  it('おためし期間中は書ける', async () => {
    const org = await newOrg({ trialEndsOn: '2099-12-31' });
    const admin = await join(org, '管理者', {
      from: '2026-01-01T00:00:00+09:00',
      role: 'admin',
    });
    const scope = await scopeOf(org, admin);

    assert.equal(scope.frozen, false);
    assert.deepEqual(await createTag(scope, 'あ', DEFAULT_TAG_COLOR), { ok: true });
  });

  it('おためし期間が切れて支払い方法が無いと、書き込みだけが止まる', async () => {
    const org = await newOrg({ trialEndsOn: '2020-01-31' });
    const admin = await join(org, '管理者', {
      from: '2026-01-01T00:00:00+09:00',
      role: 'admin',
    });
    const scope = await scopeOf(org, admin);

    assert.equal(scope.frozen, true);
    assert.deepEqual(await createTag(scope, 'い', DEFAULT_TAG_COLOR), {
      ok: false,
      reason: 'frozen',
    });

    // 読み取りは残る
    const status = await getBillingStatus(scope);
    assert.equal(status?.state, 'frozen');
    assert.deepEqual(await freezeReason(scope), { kind: 'trial', trialEndsOn: '2020-01-31' });
  });

  it('支払い方法を預かっていれば書ける', async () => {
    const org = await newOrg({ trialEndsOn: '2020-01-31', paymentMethod: true });
    const admin = await join(org, '管理者', {
      from: '2026-01-01T00:00:00+09:00',
      role: 'admin',
    });
    const scope = await scopeOf(org, admin);

    assert.equal(scope.frozen, false);
    assert.deepEqual(await createTag(scope, 'う', DEFAULT_TAG_COLOR), { ok: true });
    assert.equal((await getBillingStatus(scope))?.state, 'active');
  });

  it('未払いが残っているあいだは止まる', async () => {
    const org = await newOrg({ trialEndsOn: '2020-01-31', paymentMethod: true });
    const admin = await join(org, '管理者', {
      from: '2026-01-01T00:00:00+09:00',
      role: 'admin',
    });

    const invoiceId = await createPendingInvoice(
      { id: org.id, name: org.slug, timezone: 'Asia/Tokyo', stripeCustomerId: org.slug },
      '2026-05-01',
    );
    assert.ok(invoiceId);
    await markInvoiceOpen(invoiceId, {
      id: `in_${org.slug}`,
      pdfUrl: null,
      tax: 10,
      total: 110,
    });
    await markInvoiceUnpaid(`in_${org.slug}`);

    const scope = await scopeOf(org, admin);
    assert.equal(scope.frozen, true);
    assert.deepEqual(await createTag(scope, 'え', DEFAULT_TAG_COLOR), {
      ok: false,
      reason: 'frozen',
    });
    assert.deepEqual(await freezeReason(scope), { kind: 'unpaid' });

    // 入金すれば、その場で戻る
    await markInvoicePaid(`in_${org.slug}`);
    assert.equal((await scopeOf(org, admin)).frozen, false);
  });

  it('課金免除は、おためし期間が切れていても止まらない', async () => {
    const org = await newOrg({ trialEndsOn: '2020-01-31', exempt: true });
    const admin = await join(org, '管理者', {
      from: '2026-01-01T00:00:00+09:00',
      role: 'admin',
    });
    const scope = await scopeOf(org, admin);

    assert.equal(scope.frozen, false);
    assert.deepEqual(await createTag(scope, 'お', DEFAULT_TAG_COLOR), { ok: true });
    assert.equal((await getBillingStatus(scope))?.state, 'exempt');
  });

  it('凍結は画面の申告ではなくデータベース側で決まる', async () => {
    const org = await newOrg({ trialEndsOn: '2020-01-31' });
    const admin = await join(org, '管理者', {
      from: '2026-01-01T00:00:00+09:00',
      role: 'admin',
    });
    const scope = await scopeOf(org, admin);

    // 凍結していないと偽ったスコープを渡しても、SQL 側が弾く
    const faked: OrgScope = { ...scope, frozen: false };
    assert.deepEqual(await createTag(faked, 'か', DEFAULT_TAG_COLOR), {
      ok: false,
      reason: 'frozen',
    });
  });
});

/* ==========================================================================
   請求
   ========================================================================== */

describe('請求', () => {
  it('同じ月を二度請求しない', async () => {
    const org = await newOrg({ trialEndsOn: '2026-04-30', paymentMethod: true });
    await join(org, '管理者', { from: '2026-01-01T00:00:00+09:00', role: 'admin' });
    const target = {
      id: org.id,
      name: org.slug,
      timezone: 'Asia/Tokyo',
      stripeCustomerId: org.slug,
    };

    const first = await createPendingInvoice(target, '2026-05-01');
    const second = await createPendingInvoice(target, '2026-05-01');
    assert.ok(first);
    assert.equal(second, null, '二本目が立ってしまった');
  });

  it('数えた人と金額を焼き、あとで数え直さない', async () => {
    const org = await newOrg({ trialEndsOn: '2026-04-30', paymentMethod: true });
    const admin = await join(org, '管理者', {
      from: '2026-01-01T00:00:00+09:00',
      role: 'admin',
    });
    await join(org, '去った人', {
      from: '2026-05-02T00:00:00+09:00',
      until: '2026-05-28T00:00:00+09:00',
    });

    const invoiceId = await createPendingInvoice(
      { id: org.id, name: org.slug, timezone: 'Asia/Tokyo', stripeCustomerId: org.slug },
      '2026-05-01',
    );
    assert.ok(invoiceId);
    await markInvoiceOpen(invoiceId, {
      id: `in_${org.slug}`,
      pdfUrl: null,
      tax: 20,
      total: 220,
    });

    const scope = await scopeOf(org, admin);
    const invoices = await listInvoices(scope);
    assert.equal(invoices.length, 1);
    assert.equal(invoices[0]?.memberCount, 2);
    assert.equal(invoices[0]?.subtotal, 200);

    // 去った人が、当時の名前のまま明細に残る
    const members = await listInvoiceMembers(scope, invoiceId);
    assert.deepEqual(members.map((m) => m.displayName).sort(), ['去った人', '管理者']);
  });

  it('請求日に凍結していれば、その月は請求しない', async () => {
    const frozen = await newOrg({ trialEndsOn: '2026-04-30' });
    await join(frozen, '管理者', { from: '2026-01-01T00:00:00+09:00', role: 'admin' });

    const client = await pool.connect();
    try {
      const targets = await listOrganizationsToBill(client, '2026-05-01');
      assert.equal(
        targets.some((t) => t.id === frozen.id),
        false,
        '支払い方法の無い組織が請求の対象に入った',
      );
    } finally {
      client.release();
    }
  });

  it('おためし期間が終わった月の翌月から請求する', async () => {
    const org = await newOrg({ trialEndsOn: '2026-05-31', paymentMethod: true });
    await join(org, '管理者', { from: '2026-01-01T00:00:00+09:00', role: 'admin' });

    const client = await pool.connect();
    try {
      const may = await listOrganizationsToBill(client, '2026-05-01');
      assert.equal(
        may.some((t) => t.id === org.id),
        false,
        'おためし期間中の月が請求された',
      );

      const june = await listOrganizationsToBill(client, '2026-06-01');
      assert.equal(
        june.some((t) => t.id === org.id),
        true,
        '最初の課金対象月が漏れた',
      );
    } finally {
      client.release();
    }
  });

  it('未払いを抱えた組織には、次の月の請求を立てない', async () => {
    const org = await newOrg({ trialEndsOn: '2026-04-30', paymentMethod: true });
    await join(org, '管理者', { from: '2026-01-01T00:00:00+09:00', role: 'admin' });

    const invoiceId = await createPendingInvoice(
      { id: org.id, name: org.slug, timezone: 'Asia/Tokyo', stripeCustomerId: org.slug },
      '2026-05-01',
    );
    assert.ok(invoiceId);
    await markInvoiceOpen(invoiceId, {
      id: `in_${org.slug}`,
      pdfUrl: null,
      tax: 10,
      total: 110,
    });
    await markInvoiceUnpaid(`in_${org.slug}`);

    const client = await pool.connect();
    try {
      const june = await listOrganizationsToBill(client, '2026-06-01');
      assert.equal(
        june.some((t) => t.id === org.id),
        false,
        '凍結中の組織に請求が立った',
      );
    } finally {
      client.release();
    }

    const unpaid = await findUnpaidInvoice(org.id);
    assert.equal(unpaid?.billingMonth, '2026-05-01');
  });

  it('同じ失敗の知らせが二度届いても、状態が変わるのは一度きり', async () => {
    const org = await newOrg({ trialEndsOn: '2026-04-30', paymentMethod: true });
    await join(org, '管理者', { from: '2026-01-01T00:00:00+09:00', role: 'admin' });

    const invoiceId = await createPendingInvoice(
      { id: org.id, name: org.slug, timezone: 'Asia/Tokyo', stripeCustomerId: org.slug },
      '2026-05-01',
    );
    assert.ok(invoiceId);
    await markInvoiceOpen(invoiceId, {
      id: `in_${org.slug}`,
      pdfUrl: null,
      tax: 10,
      total: 110,
    });

    const first = await markInvoiceUnpaid(`in_${org.slug}`);
    const second = await markInvoiceUnpaid(`in_${org.slug}`);
    assert.equal(first.changed, true);
    assert.equal(second.changed, false, '二度目でもメールを出してしまう');
  });
});
