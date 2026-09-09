import { parseArgs } from 'node:util';
import { expiresAt, issueToken } from '#features/authentication/token.ts';
import { createOrganizationWithin } from '#features/organization/queries.ts';
import { SLUG_HINT } from '#features/organization/slug.ts';
import { pool, transaction } from '#lib/db.ts';

/**
 * 組織と、最初の組織管理者を作る。
 *
 *   pnpm org:create --name "株式会社アクメ" --slug acme \
 *                   --admin someone@example.com --admin-name "佐藤 明日香"
 *
 * 画面（/signup）からも作れる。こちらを残してあるのは、
 * あちらがメールの到達に依存するためである。
 * 送信が止まっている環境でも、この経路なら組織を作れる。
 *
 * 組織と所属を作る処理と slug の検証は画面と共有する（createOrganizationWithin）。
 * 分けて持つと、片方にだけ予約語が増えた日から、ここからは admin が通る。
 *
 * 最後にログイン用リンクを出力する。
 * パスワードはこの経路では設定しない。
 * 受け取った人がリンクで入り、あとから設定する。
 */

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    slug: { type: 'string' },
    admin: { type: 'string' },
    'admin-name': { type: 'string' },
  },
});

const name = values.name?.trim();
const slug = values.slug?.trim().toLowerCase();
const email = values.admin?.trim().toLowerCase();
const adminName = values['admin-name']?.trim() || email?.split('@')[0];

if (!name || !slug || !email || !adminName) {
  console.error(
    [
      '使い方:',
      '  pnpm org:create --name "株式会社アクメ" --slug acme \\',
      '                  --admin someone@example.com --admin-name "佐藤 明日香"',
      '',
      '  --admin-name は省略できる。省略するとメールアドレスの @ の左を使う。',
    ].join('\n'),
  );
  process.exit(1);
}

/** 組織を作れなかった理由を、手元で読める文にする。 */
const PROBLEM: Record<string, string> = {
  'invalid-name': '組織名を入力してください',
  'invalid-slug': `slug の形が正しくありません。${SLUG_HINT}`,
  'reserved-slug': 'その slug は予約語です。別の名前にしてください。',
  'slug-taken': 'その slug はすでに使われています。',
};

const { token, hash } = issueToken();

const created = await transaction(async (client) => {
  /*
   * すでにこのアドレスのアカウントがあれば、それを使う。
   * ひとりが複数の組織に所属するので、作り直してはいけない。
   */
  const existing = await client.query<{ id: string }>(
    'SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL',
    [email],
  );
  let userId = existing.rows[0]?.id;

  if (!userId) {
    const inserted = await client.query<{ id: string }>(
      'INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id',
      [email, adminName],
    );
    userId = inserted.rows[0]?.id;
  }
  if (!userId) {
    throw new Error('アカウントを作れませんでした');
  }

  const organization = await createOrganizationWithin(client, userId, { name, slug });
  if (!organization.ok) {
    throw new Error(PROBLEM[organization.reason]);
  }

  await client.query(
    'INSERT INTO magic_link_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, hash, expiresAt()],
  );

  return { userId, reused: existing.rows.length > 0 };
});

await pool.end();

const origin = process.env.APP_ORIGIN ?? 'http://localhost:3000';

console.log(
  [
    '',
    `  組織      ${name} (${slug})`,
    `  管理者    ${adminName} <${email}>${created.reused ? '  ※ 既存のアカウントを使った' : ''}`,
    '',
    '  下のリンクからログインできる。48時間で切れる。',
    '',
    `  ${origin}/auth/magic?token=${encodeURIComponent(token)}`,
    '',
    '  リンクはメールで送っていない。この出力から本人へ渡すこと。',
    '',
  ].join('\n'),
);
