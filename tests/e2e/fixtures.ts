import { createHash, randomBytes } from 'node:crypto';
import { test as base } from '@playwright/test';
import pg from 'pg';

/* ==========================================================================
   下ごしらえ

   確認のメールを受け取れないもの（組織登録のリンク、マジックリンク）と、
   試験の出発点になる組織はデータベースへ直に入れる。
   本番へ向けるときは手が届かないので、これを使う試験は外れる。

   後片付けは、蒔いた種を印で拾って消す。
   印は走らせるたびに変えるので、途中で落ちても次の回に当たらない。
   ========================================================================== */

/** 接続先を与えられたら、データベースには手が届かない。 */
export const canSeed = !process.env.E2E_BASE_URL;

const url = process.env.DATABASE_URL;

export type Sown = {
  readonly tag: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly projectKey: string;
  readonly threadNumber: number;
  readonly asukaId: string;
  readonly ryoId: string;
  /** そのままリンクに入れる。/auth/magic?token= の後ろに置く */
  readonly magicToken: string;
  /** 組織登録の確認リンク。/signup?token= の後ろに置く */
  readonly signupToken: string;
  /** その確認リンクが指すアドレス。まだアカウントは無い */
  readonly signupEmail: string;
};

function client(): pg.Client {
  if (!url) {
    throw new Error('DATABASE_URL が設定されていません');
  }
  return new pg.Client({ connectionString: url, options: '-c timezone=UTC' });
}

async function value<T = string>(
  c: pg.Client,
  sql: string,
  params: unknown[] = [],
): Promise<T> {
  const { rows } = await c.query(sql, params);
  const row = rows[0];
  if (!row) {
    throw new Error(`行が返りませんでした: ${sql}`);
  }
  return Object.values(row)[0] as T;
}

/**
 * 組織、二人、プロジェクト、課題ひとつを置く。
 *
 * 課題には担当者と期間と進捗を入れてある。
 * 属性の欄を押す試験が、押す前の値を持っていないと始まらない。
 */
export async function sow(): Promise<Sown> {
  const tag = `e2e-${randomBytes(4).toString('hex')}`;
  const c = client();
  await c.connect();

  try {
    const organizationId = await value(
      c,
      "INSERT INTO organizations (name, slug) VALUES ('株式会社アクメ', $1) RETURNING id",
      [tag],
    );
    const asukaId = await value(
      c,
      "INSERT INTO users (email, display_name) VALUES ($1, '佐藤 明日香') RETURNING id",
      [`${tag}-asuka@example.com`],
    );
    const ryoId = await value(
      c,
      "INSERT INTO users (email, display_name) VALUES ($1, '田中 亮') RETURNING id",
      [`${tag}-ryo@example.com`],
    );
    for (const userId of [asukaId, ryoId]) {
      await c.query(
        "INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,'admin')",
        [organizationId, userId],
      );
    }

    const projectKey = 'E2E';
    const projectId = await value(
      c,
      `INSERT INTO projects (organization_id, key, name, created_by_user_id)
       VALUES ($1,$2,'検索基盤の刷新',$3) RETURNING id`,
      [organizationId, projectKey, asukaId],
    );

    const threadNumber = Number(
      await value<string>(
        c,
        `UPDATE organizations SET next_thread_number = next_thread_number + 1
          WHERE id = $1 RETURNING next_thread_number - 1`,
        [organizationId],
      ),
    );
    await c.query(
      `INSERT INTO threads
         (organization_id, project_id, number, type, title, body, created_by_user_id,
          assignee_user_id, progress, starts_on, ends_on)
       VALUES ($1,$2,$3,'kadai','検索の設計','どう組むかを決める。',$4,$5,40,'2026-09-10','2026-09-20')`,
      [organizationId, projectId, threadNumber, asukaId, asukaId],
    );

    // 保存されるのは生の値ではなくハッシュである
    const magicToken = randomBytes(24).toString('base64url');
    await c.query(
      `INSERT INTO magic_link_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '1 hour')`,
      [asukaId, createHash('sha256').update(magicToken).digest()],
    );

    /*
     * 組織登録の確認リンク。まだアカウントの無いアドレスに向けて置く。
     * 画面からは組織を作れるが、確認のメールは受け取れないので、ここで置く。
     */
    const signupToken = randomBytes(24).toString('base64url');
    const signupEmail = `${tag}-new@example.com`;
    await c.query(
      `INSERT INTO signup_tokens (email, token_hash, expires_at)
       VALUES ($1, $2, now() + interval '1 hour')`,
      [signupEmail, createHash('sha256').update(signupToken).digest()],
    );

    return {
      tag,
      organizationId,
      projectId,
      projectKey,
      threadNumber,
      asukaId,
      ryoId,
      magicToken,
      signupToken,
      signupEmail,
    };
  } finally {
    await c.end();
  }
}

/** 蒔いた種を消す。参照している側から順に落とす。 */
export async function reap(tag: string): Promise<void> {
  const c = client();
  await c.connect();
  /*
   * 組織登録の試験は、種の tag を先頭に持つ別の組織を作る。
   * 前方一致で拾わないと、その組織だけが残る。
   */
  const like = `${tag}%`;
  const inOrg = 'organization_id IN (SELECT id FROM organizations WHERE slug LIKE $1)';
  try {
    await c.query(`DELETE FROM notifications WHERE ${inOrg}`, [like]);
    await c.query(`DELETE FROM attachments WHERE ${inOrg} RETURNING storage_key`, [like]);
    await c.query(
      `DELETE FROM comment_mentions WHERE comment_id IN
       (SELECT id FROM comments WHERE ${inOrg})`,
      [like],
    );
    await c.query(
      `DELETE FROM comment_checks WHERE comment_id IN
       (SELECT id FROM comments WHERE ${inOrg})`,
      [like],
    );
    await c.query(`DELETE FROM comments WHERE ${inOrg}`, [like]);
    await c.query(
      `DELETE FROM watches WHERE thread_id IN
       (SELECT id FROM threads WHERE ${inOrg})`,
      [like],
    );
    await c.query(
      `DELETE FROM thread_tags WHERE thread_id IN
       (SELECT id FROM threads WHERE ${inOrg})`,
      [like],
    );
    await c.query(`DELETE FROM tags WHERE ${inOrg}`, [like]);
    await c.query(`DELETE FROM threads WHERE ${inOrg}`, [like]);
    await c.query(
      `DELETE FROM project_members WHERE project_id IN
       (SELECT id FROM projects WHERE ${inOrg})`,
      [like],
    );
    await c.query(`DELETE FROM projects WHERE ${inOrg}`, [like]);
    await c.query(`DELETE FROM organization_members WHERE ${inOrg}`, [like]);
    await c.query(
      `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
      [`${tag}-%`],
    );
    await c.query(
      `DELETE FROM magic_link_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
      [`${tag}-%`],
    );
    await c.query('DELETE FROM signup_tokens WHERE email LIKE $1', [`${tag}-%`]);
    await c.query('DELETE FROM users WHERE email LIKE $1', [`${tag}-%`]);
    await c.query('DELETE FROM organizations WHERE slug LIKE $1', [like]);
  } finally {
    await c.end();
  }
}

/**
 * 蒔いた組織を凍結させる。
 *
 * おためし期限を過ぎたことにするだけである。支払い方法は預けていない。
 * 画面の側の判定はリクエストのたびに走るので、これで次の一手から凍る。
 */
export async function freeze(organizationId: string): Promise<void> {
  const c = client();
  await c.connect();
  try {
    await c.query(`UPDATE organizations SET trial_ends_on = CURRENT_DATE - 1 WHERE id = $1`, [
      organizationId,
    ]);
  } finally {
    await c.end();
  }
}

/** 組織管理者から降ろす。凍結の帯が役割で変わることを確かめるのに使う。 */
export async function demote(organizationId: string, userId: string): Promise<void> {
  const c = client();
  await c.connect();
  try {
    await c.query(
      `UPDATE organization_members SET role = 'member'
        WHERE organization_id = $1 AND user_id = $2`,
      [organizationId, userId],
    );
  } finally {
    await c.end();
  }
}

/**
 * 種を蒔いた状態でひとつ試験を走らせ、終わったら消す。
 *
 * 接続先を与えられているときは、この道具を使う試験ごと外す。
 */
export const test = base.extend<{ sown: Sown }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright の道具はこの形で受ける
  sown: async ({}, use) => {
    const sown = await sow();
    try {
      await use(sown);
    } finally {
      await reap(sown.tag);
    }
  },
});

export { expect } from '@playwright/test';
