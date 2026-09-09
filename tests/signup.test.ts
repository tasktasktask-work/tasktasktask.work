import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { hashToken } from '#features/authentication/token.ts';
import { createOrganization } from '#features/organization/queries.ts';
import { completeSignup, previewSignup, startSignup } from '#features/organization/signup.ts';
import { checkSlug, RESERVED_SLUGS, SLUG_PATTERN } from '#features/organization/slug.ts';
import { pool } from '#lib/db.ts';

/*
 * 組織登録。
 *
 * 招待と違い、これは「入る先を新しく作る」経路である。
 * 誰でも通れるので、通れてはいけない道が塞がっていることのほうが要点になる。
 *
 * ここで扱う関数は pool を直に使うので、トランザクションで巻き戻せない。
 * 作った行は印を付けておき、最後にまとめて消す。
 */

const TAG = `sgnt-${process.pid}`;
let seq = 0;
const uniq = (): string => {
  seq += 1;
  return `${TAG}-${seq}`;
};

/** メールはコンソールに出る。試験のあいだは黙らせる。 */
const info = console.info;
console.info = () => {};

after(async () => {
  const like = `${TAG}-%`;
  await pool.query(`DELETE FROM signup_tokens WHERE email LIKE $1`, [like]);
  await pool.query(
    `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [like],
  );
  await pool.query(
    `DELETE FROM organization_members WHERE organization_id IN
       (SELECT id FROM organizations WHERE slug LIKE $1)`,
    [like],
  );
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [like]);
  await pool.query(`DELETE FROM organizations WHERE slug LIKE $1`, [like]);
  await pool.end();
  console.info = info;
});

/* --------------------------------------------------------------------------
   下ごしらえ
   -------------------------------------------------------------------------- */

async function value<T = string>(sql: string, params: unknown[]): Promise<T> {
  const { rows } = await pool.query(sql, params);
  const row = rows[0];
  if (!row) {
    throw new Error(`行が返りませんでした: ${sql}`);
  }
  return Object.values(row)[0] as T;
}

/** 送信を経ずにトークンを置く。文面ではなく、使われ方を試すため。 */
async function tokenFor(
  email: string,
  options: { hoursLeft?: number; used?: boolean } = {},
): Promise<string> {
  const token = `${uniq()}-token`;
  await pool.query(
    `INSERT INTO signup_tokens (email, token_hash, expires_at, used_at)
     VALUES ($1, $2, now() + ($3 || ' hours')::interval, $4)`,
    [
      email,
      hashToken(token),
      String(options.hoursLeft ?? 48),
      options.used ? new Date() : null,
    ],
  );
  return token;
}

const address = (): string => `${uniq()}@example.com`;

/* --------------------------------------------------------------------------
   slug
   -------------------------------------------------------------------------- */

describe('slug の検証', () => {
  it('前後の空白を落とし、小文字に揃える', () => {
    assert.deepEqual(checkSlug('  ACME  '), { ok: true, slug: 'acme' });
  });

  it('形の合わないものを断る', () => {
    for (const bad of ['ac', '-acme', 'acme-', 'ac me', 'アクメ', 'a'.repeat(41)]) {
      assert.equal(checkSlug(bad).ok, false, `通ってしまった: ${bad}`);
    }
  });

  it('予約語を断る', () => {
    for (const word of RESERVED_SLUGS.filter((w) => SLUG_PATTERN.test(w))) {
      assert.deepEqual(checkSlug(word), { ok: false, reason: 'reserved-slug' });
    }
  });

  it('3文字に満たない予約語は、長さのほうで断る', () => {
    // o と me は形の時点で通らない。予約語の一覧には記録として残してある
    assert.deepEqual(checkSlug('o'), { ok: false, reason: 'invalid-slug' });
    assert.deepEqual(checkSlug('me'), { ok: false, reason: 'invalid-slug' });
  });
});

/* --------------------------------------------------------------------------
   発行
   -------------------------------------------------------------------------- */

describe('確認のリンクを送る', () => {
  it('行がひとつできる', async () => {
    const email = address();
    await startSignup(email);

    const count = await value<string>(
      `SELECT count(*) FROM signup_tokens WHERE email = $1 AND used_at IS NULL`,
      [email],
    );
    assert.equal(count, '1');
  });

  it('間隔の中の二度目は、新しく送らない', async () => {
    const email = address();
    await startSignup(email);
    const first = await value<string>(`SELECT id::text FROM signup_tokens WHERE email = $1`, [
      email,
    ]);

    await startSignup(email);

    const rows = await pool.query(`SELECT id::text FROM signup_tokens WHERE email = $1`, [
      email,
    ]);
    assert.equal(rows.rowCount, 1, '二本目が増えている');
    assert.equal(rows.rows[0]?.id, first, '中身が入れ替わっている');
  });

  it('間隔を過ぎたら、古いリンクは使えなくなる', async () => {
    const email = address();
    const old = await tokenFor(email);
    await pool.query(
      `UPDATE signup_tokens SET created_at = now() - interval '10 minutes' WHERE email = $1`,
      [email],
    );

    await startSignup(email);

    assert.deepEqual(await previewSignup(old), { ok: false, reason: 'invalid' });
    const count = await value<string>(`SELECT count(*) FROM signup_tokens WHERE email = $1`, [
      email,
    ]);
    assert.equal(count, '1', '有効なリンクは一本だけである');
  });

  it('形の合わないアドレスでは、何も起きない', async () => {
    await startSignup('not-an-address');
    const count = await value<string>(`SELECT count(*) FROM signup_tokens WHERE email = $1`, [
      'not-an-address',
    ]);
    assert.equal(count, '0');
  });
});

/* --------------------------------------------------------------------------
   下見
   -------------------------------------------------------------------------- */

describe('リンクの下見', () => {
  it('開いただけでは消費しない', async () => {
    const email = address();
    const token = await tokenFor(email);

    const first = await previewSignup(token);
    assert.equal(first.ok, true);

    const used = await value<string>(
      `SELECT count(*) FROM signup_tokens WHERE email = $1 AND used_at IS NOT NULL`,
      [email],
    );
    assert.equal(used, '0');
  });

  it('期限切れ、使用済み、存在しないを区別する', async () => {
    const expired = await tokenFor(address(), { hoursLeft: -1 });
    const used = await tokenFor(address(), { used: true });

    assert.deepEqual(await previewSignup(expired), { ok: false, reason: 'expired' });
    assert.deepEqual(await previewSignup(used), { ok: false, reason: 'used' });
    assert.deepEqual(await previewSignup('どこにも無い値'), { ok: false, reason: 'invalid' });
  });

  it('アカウントの有無を返す', async () => {
    const email = address();
    const token = await tokenFor(email);

    const before = await previewSignup(token);
    assert.equal(before.ok && before.preview.needsAccount, true);

    await pool.query('INSERT INTO users (email, display_name) VALUES ($1,$2)', [email, '既存']);

    const after = await previewSignup(token);
    assert.equal(after.ok && after.preview.needsAccount, false);
  });
});

/* --------------------------------------------------------------------------
   完了
   -------------------------------------------------------------------------- */

describe('組織を作る', () => {
  it('アカウント、組織、組織管理者としての所属、セッションができる', async () => {
    const email = address();
    const token = await tokenFor(email);
    const slug = uniq();

    const result = await completeSignup(token, {
      organizationName: '株式会社アクメ',
      slug,
      displayName: '佐藤 明日香',
      password: 'correct horse battery',
    });

    assert.equal(result.ok, true);
    assert.equal(result.ok && result.slug, slug);

    const role = await value<string>(
      `SELECT m.role
         FROM organization_members m
         JOIN organizations o ON o.id = m.organization_id
         JOIN users u ON u.id = m.user_id
        WHERE o.slug = $1 AND u.email = $2`,
      [slug, email],
    );
    assert.equal(role, 'admin');

    const sessions = await value<string>(
      `SELECT count(*) FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = $1`,
      [email],
    );
    assert.equal(sessions, '1');

    // 一度きり
    assert.deepEqual(await previewSignup(token), { ok: false, reason: 'used' });
  });

  it('すでにあるアカウントの表示名とパスワードに触らない', async () => {
    const email = address();
    await pool.query(
      `INSERT INTO users (email, display_name, password_hash, failed_login_count, locked_at)
       VALUES ($1, $2, $3, 10, now())`,
      [email, '田中 亮', 'もとのハッシュ'],
    );
    const token = await tokenFor(email);

    const result = await completeSignup(token, {
      organizationName: '合同会社ベータ',
      slug: uniq(),
      displayName: '別の名前',
      password: 'すり替えたパスワード',
    });
    assert.equal(result.ok, true);

    const { rows } = await pool.query(
      `SELECT display_name, password_hash, locked_at FROM users WHERE email = $1`,
      [email],
    );
    assert.equal(rows[0]?.display_name, '田中 亮');
    assert.equal(rows[0]?.password_hash, 'もとのハッシュ');
    // リンクを踏めたことが本人の証拠になる。招待の受諾と同じくロックは解ける
    assert.equal(rows[0]?.locked_at, null);
  });

  it('slug が埋まっていたら、リンクを消費しない', async () => {
    const taken = uniq();
    await pool.query('INSERT INTO organizations (name, slug) VALUES ($1,$2)', ['先客', taken]);

    const email = address();
    const token = await tokenFor(email);

    const result = await completeSignup(token, {
      organizationName: '株式会社アクメ',
      slug: taken,
      displayName: '佐藤 明日香',
      password: 'correct horse battery',
    });
    assert.deepEqual(result, { ok: false, reason: 'slug-taken' });

    // 同じリンクで入れ直せる
    assert.equal((await previewSignup(token)).ok, true);

    // 作りかけのアカウントも残っていない
    const users = await value<string>(`SELECT count(*) FROM users WHERE email = $1`, [email]);
    assert.equal(users, '0');
  });

  it('予約語の slug を断る', async () => {
    const token = await tokenFor(address());
    const result = await completeSignup(token, {
      organizationName: '株式会社アクメ',
      slug: 'admin',
      displayName: '佐藤 明日香',
      password: 'correct horse battery',
    });
    assert.deepEqual(result, { ok: false, reason: 'reserved-slug' });
  });

  it('新しいアカウントには表示名とパスワードが要る', async () => {
    const token = await tokenFor(address());
    assert.deepEqual(
      await completeSignup(token, {
        organizationName: 'ア',
        slug: uniq(),
        password: 'x'.repeat(8),
      }),
      { ok: false, reason: 'display-name-required' },
    );
    assert.deepEqual(
      await completeSignup(token, {
        organizationName: 'ア',
        slug: uniq(),
        displayName: '佐藤',
        password: 'みじかい',
      }),
      { ok: false, reason: 'password-too-short' },
    );
  });
});

/* --------------------------------------------------------------------------
   ログイン済みの経路
   -------------------------------------------------------------------------- */

describe('ログイン済みの人が作る', () => {
  it('作った人が組織管理者になる', async () => {
    const userId = await value(
      'INSERT INTO users (email, display_name) VALUES ($1,$2) RETURNING id',
      [address(), '佐藤 明日香'],
    );
    const slug = uniq();

    const result = await createOrganization(userId, { name: '株式会社アクメ', slug });
    assert.equal(result.ok, true);

    const role = await value<string>(
      `SELECT role FROM organization_members m
         JOIN organizations o ON o.id = m.organization_id
        WHERE o.slug = $1 AND m.user_id = $2`,
      [slug, userId],
    );
    assert.equal(role, 'admin');
  });

  it('埋まっている slug と空の組織名を断る', async () => {
    const userId = await value(
      'INSERT INTO users (email, display_name) VALUES ($1,$2) RETURNING id',
      [address(), '佐藤 明日香'],
    );
    const slug = uniq();
    await createOrganization(userId, { name: '先客', slug });

    assert.deepEqual(await createOrganization(userId, { name: 'あと', slug }), {
      ok: false,
      reason: 'slug-taken',
    });
    assert.deepEqual(await createOrganization(userId, { name: '  ', slug: uniq() }), {
      ok: false,
      reason: 'invalid-name',
    });
  });
});
