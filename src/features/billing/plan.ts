/* ==========================================================================
   料金の決まり

   単価と通貨と暦だけを置く。ここに判定は書かない。
   仕様は docs/features/billing/index.html にある。
   ========================================================================== */

/** 決済の通貨。どの国の組織からも同じ通貨で受け取る。 */
export const CURRENCY = 'usd';

/**
 * 単価。1人あたり、ひと月あたり。税込 1 ドル。
 *
 * 値はセントで持つ。USD は小数を二桁持つ通貨で、
 * Stripe に渡す金額もセント単位である（100 が $1.00）。
 * 円のような小数を持たない通貨とは、同じ 100 でも意味が違う。
 *
 * 税を別に取らないのは、適格請求書発行事業者の登録をしていないためである。
 * 納めていない税を税として請求する形にはしない。
 */
export const UNIT_PRICE = 100;

/**
 * 請求を切る暦。組織ごとの timezone ではなく、事業者側に固定する。
 *
 * 組織のタイムゾーンで切ると、締め日が組織ごとにずれる。
 * ずれた締め日は説明できない。
 *
 * ただし「その月に在籍したか」の境目だけは組織のタイムゾーンで見る。
 * そちらは相手の一日がいつ始まるかの話である。
 */
export const BILLING_TIMEZONE = 'Asia/Tokyo';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** セントの整数を $1.00 の形にする。 */
export function formatMoney(minorUnits: number): string {
  return money.format(minorUnits / 100);
}

/** '2026-11-01' を '2026年11月' にする。 */
export function formatBillingMonth(month: string): string {
  const [year, mon] = month.split('-');
  return `${year}年${Number(mon)}月`;
}

/** '2026-10-31' を '2026年10月31日' にする。 */
export function formatDay(day: string): string {
  const [year, mon, date] = day.split('-');
  return `${year}年${Number(mon)}月${Number(date)}日`;
}

/** 課金人数から合計を出す。税を別に足さないので、これが請求額になる。 */
export function subtotalOf(memberCount: number): number {
  return memberCount * UNIT_PRICE;
}
