import {
  currentBillingMonth,
  deliverTrialNotices,
  runMonthlyBilling,
} from '#features/billing/monthly.ts';
import { formatBillingMonth } from '#features/billing/plan.ts';
import { diagnoseBilling } from '#features/billing/queries.ts';
import { pool } from '#lib/db.ts';
import { billingMode } from '#lib/env.ts';

/**
 * 課金の巡回を、その場で一度だけ回す。
 *
 *   pnpm billing:run
 *
 * 普段はアプリの中で 5 分ごとに回っているので、これを打つ必要は無い。
 * 使うのは二つの場面である。
 *
 * ひとつは、繋いだばかりの決済代行との疎通を確かめるとき。
 * 5 分待たずに、請求が立つところまで進められる。
 *
 * もうひとつは、アプリが長く落ちていたあとの取り戻しである。
 * 巡回は日で区切っていないので、起き上がれば自分で追いつくが、
 * 待たずに済ませたいときにここから叩ける。
 *
 * 何度打っても結果は変わらない。同じ月の請求は一本しか立たない。
 */

if (billingMode() === 'off') {
  console.error('BILLING_MODE が off です。課金の巡回は動きません。');
  process.exit(1);
}

const billingMonth = await currentBillingMonth();
console.log(
  `課金の巡回を回します（BILLING_MODE=${billingMode()} / 対象月 ${formatBillingMonth(billingMonth)}）`,
);

const billed = await runMonthlyBilling();
console.log(
  `請求: 確定 ${billed.issued} / 入金 ${billed.paid} / 失敗 ${billed.failed} / 詰まり ${billed.stuck}`,
);

const notified = await deliverTrialNotices();
console.log(`おためし終了の知らせ: ${notified} 通`);

/*
 * 0 件のときは、なぜ立たなかったかを組織ごとに出す。
 * 条件の一覧を読ませるより、当たっている行を見せたほうが早い。
 */
if (billed.issued === 0) {
  console.log('');
  console.log(`${formatBillingMonth(billingMonth)}分が立たなかった理由:`);
  for (const row of await diagnoseBilling(billingMonth)) {
    const state = row.reason ?? '対象（次の巡回で立つ）';
    console.log(`  ${row.slug.padEnd(18)} ${state}（この月の在籍 ${row.memberCount} 人）`);
  }
}

await pool.end();
