import { parseArgs } from 'node:util';
import { expiresAt, issueToken } from '#features/authentication/token.ts';
import { pool, transaction } from '#lib/db.ts';

/**
 * 組織と、最初の組織管理者を作る。
 *
 *   pnpm org:create --name "株式会社アクメ" --slug acme \
 *                   --admin someone@example.com --admin-name "佐藤 明日香"
 *
 * 画面からは組織を作れない。参加は招待だけで、招待を送れるのは
 * 組織管理者だけなので、最初のひとりだけは外から入れる必要がある。
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

const { token, hash } = issueToken();

const created = await transaction(async (client) => {
  const organization = await client.query<{ id: string }>(
    'INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id',
    [name, slug],
  );
  const organizationId = organization.rows[0]?.id;
  if (!organizationId) {
    throw new Error('組織を作れませんでした');
  }

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

  await client.query(
    `INSERT INTO organization_members (organization_id, user_id, role)
     VALUES ($1, $2, 'admin')`,
    [organizationId, userId],
  );

  await client.query(
    'INSERT INTO magic_link_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, hash, expiresAt()],
  );

  return { organizationId, userId, reused: existing.rows.length > 0 };
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
