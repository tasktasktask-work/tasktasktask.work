import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { pool } from '#lib/db.ts';

/**
 * 組織を課金免除にする、あるいは免除をやめる。
 *
 *   pnpm org:exempt   acme
 *   pnpm org:unexempt acme
 *
 * 画面からは操作できない。社内で使う組織、デモ用の組織、
 * 支払いの取り決めが特殊な相手に使う、運用側の例外である。
 *
 * 免除をやめると、おためし期間がすでに切れている組織はその場で凍結する。
 * 打った瞬間に相手の業務が止まるので、組織名を出して確認を求める。
 */

const { values, positionals } = parseArgs({
  options: { on: { type: 'boolean' }, yes: { type: 'boolean' } },
  allowPositionals: true,
});

const slug = positionals[0]?.trim().toLowerCase();
const exempt = values.on === true;

if (!slug) {
  console.error(
    ['使い方:', '  pnpm org:exempt   <slug>', '  pnpm org:unexempt <slug>'].join('\n'),
  );
  process.exit(1);
}

const { rows } = await pool.query<{
  id: string;
  name: string;
  billing_exempt: boolean;
  trial_ends_on: string;
}>(
  `SELECT id, name, billing_exempt, trial_ends_on
     FROM organizations
    WHERE slug = $1 AND deleted_at IS NULL`,
  [slug],
);

const org = rows[0];
if (!org) {
  console.error(`組織が見つかりません: ${slug}`);
  await pool.end();
  process.exit(1);
}

if (org.billing_exempt === exempt) {
  console.log(`${org.name}（${slug}）は、すでに${exempt ? '免除' : '免除なし'}です。`);
  await pool.end();
  process.exit(0);
}

/*
 * 免除を外すほうだけ確認を挟む。付けるほうは相手の業務を止めない。
 */
if (!exempt && !values.yes) {
  const { rows: frozenRows } = await pool.query<{ will_freeze: boolean }>(
    `SELECT (o.trial_ends_on < (now() AT TIME ZONE o.timezone)::date
             AND o.payment_method_set_at IS NULL) AS will_freeze
       FROM organizations o WHERE o.id = $1`,
    [org.id],
  );

  console.log(`${org.name}（${slug}）の課金免除をやめます。`);
  if (frozenRows[0]?.will_freeze) {
    console.log('この組織はおためし期間が終わっており、実行するとその場で凍結します。');
    console.log('書き込みが止まり、閲覧と添付のダウンロードだけが残ります。');
  }

  const ask = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await ask.question('続けるには組織の slug を入力してください: ');
  ask.close();

  if (answer.trim().toLowerCase() !== slug) {
    console.error('入力が一致しませんでした。何も変えていません。');
    await pool.end();
    process.exit(1);
  }
}

await pool.query(`UPDATE organizations SET billing_exempt = $2 WHERE id = $1`, [
  org.id,
  exempt,
]);
console.log(
  `${org.name}（${slug}）を${exempt ? '課金免除にしました' : '課金の対象に戻しました'}。`,
);
await pool.end();
