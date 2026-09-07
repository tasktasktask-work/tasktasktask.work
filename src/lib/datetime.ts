/* ==========================================================================
   表示のための時刻の変換

   保存されているのは UTC の一点である（timestamptz）。
   何時に見えるかは、その組織の設定で決まる。

   接続プールは複数の組織のリクエストを捌くので、データベース側の
   セッション設定に頼れない（docs/devops/coding-conventions/index.html#datetime）。
   そこで、組織のタイムゾーンをここまで持ち回り、表示の直前で当てる。

   date 列は文字列のまま来る（'YYYY-MM-DD'）ので、この変換を通さない。
   通すと、日付を一度 Date にした時点でずれる。
   ========================================================================== */

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  // 一覧では行の数だけ呼ばれる。Intl.DateTimeFormat の生成は安くない。
  const key = `${timezone} ${JSON.stringify(options)}`;
  const found = cache.get(key);
  if (found) {
    return found;
  }
  const created = new Intl.DateTimeFormat('ja-JP', { ...options, timeZone: timezone });
  cache.set(key, created);
  return created;
}

function pick(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value ?? '';
}

/** 2026-09-04 13:40 */
export function formatDateTime(value: Date, timezone: string): string {
  const parts = formatter(timezone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(value);
  return `${pick(parts, 'year')}-${pick(parts, 'month')}-${pick(parts, 'day')} ${pick(parts, 'hour')}:${pick(parts, 'minute')}`;
}

/** 9/4 13:40。一覧の右端に置く、桁を食わない形。 */
export function formatStamp(value: Date, timezone: string): string {
  const parts = formatter(timezone, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(value);
  return `${pick(parts, 'month')}/${pick(parts, 'day')} ${pick(parts, 'hour')}:${pick(parts, 'minute')}`;
}

/** 2026年9月4日。作成者の行など、読ませたいところで使う。 */
export function formatDay(value: Date, timezone: string): string {
  return formatter(timezone, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(value);
}
