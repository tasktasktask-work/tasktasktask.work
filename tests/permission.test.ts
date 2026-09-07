import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import type pg from 'pg';
import { listThreads } from '#features/thread/queries.ts';
import { pool, VISIBLE_PROJECT_IDS } from '#lib/db.ts';
import { withRollback } from './helpers.ts';

/*
 * 閲覧できるプロジェクトの判定。
 *
 * ここが漏れると、他社のデータと非公開プロジェクトが見える。
 * このシステムで最も起きてはならないことなので、
 * 実装より先に、振る舞いを固定しておく。
 *
 * 判定は #lib/db.ts の VISIBLE_PROJECT_IDS にだけ書いてある。
 * 各所に書き写さないので、ここを守れば全体が守られる。
 */

// 閉じないと、接続が空くまでテストの終了が待たされる
after(async () => {
  await pool.end();
});

/** 誰に、どのプロジェクトが見えるか */
async function visibleTo(
  client: pg.Client,
  organizationId: string,
  userId: string,
): Promise<Set<string>> {
  const { rows } = await client.query<{ id: string }>(VISIBLE_PROJECT_IDS, [
    organizationId,
    userId,
  ]);
  return new Set(rows.map((r) => r.id));
}

/* --------------------------------------------------------------------------
   下ごしらえ

   組織を二つ置く。片方に、立場の違う人と、状態の違うプロジェクトを並べる。
   -------------------------------------------------------------------------- */

let seq = 0;
const uniq = () => {
  seq += 1;
  return `${process.pid}-${seq}`;
};

async function value<T = string>(
  c: pg.Client | pg.Pool,
  sql: string,
  params: unknown[],
): Promise<T> {
  const { rows } = await c.query(sql, params);
  const row = rows[0];
  if (!row) {
    throw new Error(`行が返りませんでした: ${sql}`);
  }
  return Object.values(row)[0] as T;
}

async function newOrg(c: pg.Client, name: string): Promise<string> {
  return value(c, 'INSERT INTO organizations (name, slug) VALUES ($1,$2) RETURNING id', [
    name,
    `perm-${uniq()}`,
  ]);
}

async function newUser(c: pg.Client, name: string): Promise<string> {
  return value(c, 'INSERT INTO users (email, display_name) VALUES ($1,$2) RETURNING id', [
    `perm-${uniq()}@example.com`,
    name,
  ]);
}

async function joinOrg(
  c: pg.Client,
  org: string,
  user: string,
  role: 'admin' | 'member',
  removed = false,
): Promise<void> {
  await c.query(
    `INSERT INTO organization_members (organization_id, user_id, role, deleted_at)
     VALUES ($1,$2,$3,$4)`,
    [org, user, role, removed ? new Date() : null],
  );
}

async function newProject(
  c: pg.Client,
  org: string,
  by: string,
  visibility: 'public' | 'private',
  state: 'active' | 'archived' | 'deleted' = 'active',
): Promise<string> {
  const archived = state !== 'active' ? new Date() : null;
  const deleted = state === 'deleted' ? new Date() : null;
  return value(
    c,
    `INSERT INTO projects (organization_id, key, name, created_by_user_id,
                           visibility, archived_at, deleted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [
      org,
      `P${String(seq).padStart(2, '0')}`.slice(0, 10),
      '検証用',
      by,
      visibility,
      archived,
      deleted,
    ],
  );
}

async function joinProject(
  c: pg.Client,
  project: string,
  user: string,
  removed = false,
): Promise<void> {
  await c.query(
    `INSERT INTO project_members (project_id, user_id, deleted_at) VALUES ($1,$2,$3)`,
    [project, user, removed ? new Date() : null],
  );
}

/* ========================================================================== */

describe('公開プロジェクト', () => {
  it('組織のメンバーには見える', async () => {
    await withRollback(async (c) => {
      const org = await newOrg(c, 'アクメ');
      const admin = await newUser(c, '管理者');
      const member = await newUser(c, 'メンバー');
      await joinOrg(c, org, admin, 'admin');
      await joinOrg(c, org, member, 'member');
      const pub = await newProject(c, org, admin, 'public');

      assert.ok((await visibleTo(c, org, member)).has(pub));
    });
  });

  it('組織に属さない人には見えない', async () => {
    await withRollback(async (c) => {
      const org = await newOrg(c, 'アクメ');
      const admin = await newUser(c, '管理者');
      const stranger = await newUser(c, 'よそのひと');
      await joinOrg(c, org, admin, 'admin');
      const pub = await newProject(c, org, admin, 'public');

      assert.equal((await visibleTo(c, org, stranger)).has(pub), false);
    });
  });

  it('別の組織の人には見えない', async () => {
    await withRollback(async (c) => {
      const acme = await newOrg(c, 'アクメ');
      const other = await newOrg(c, 'よその会社');
      const admin = await newUser(c, '管理者');
      const outsider = await newUser(c, 'よその社員');
      await joinOrg(c, acme, admin, 'admin');
      await joinOrg(c, other, outsider, 'admin'); // よそでは管理者
      const pub = await newProject(c, acme, admin, 'public');

      // よその組織で管理者であっても、こちらは見えない
      assert.equal((await visibleTo(c, acme, outsider)).size, 0);
      assert.equal((await visibleTo(c, acme, outsider)).has(pub), false);
    });
  });
});

describe('非公開プロジェクト', () => {
  it('組織のメンバーというだけでは見えない', async () => {
    await withRollback(async (c) => {
      const org = await newOrg(c, 'アクメ');
      const admin = await newUser(c, '管理者');
      const member = await newUser(c, 'メンバー');
      await joinOrg(c, org, admin, 'admin');
      await joinOrg(c, org, member, 'member');
      const sec = await newProject(c, org, admin, 'private');

      assert.equal((await visibleTo(c, org, member)).has(sec), false);
    });
  });

  it('プロジェクトのメンバーには見える', async () => {
    await withRollback(async (c) => {
      const org = await newOrg(c, 'アクメ');
      const admin = await newUser(c, '管理者');
      const member = await newUser(c, 'メンバー');
      await joinOrg(c, org, admin, 'admin');
      await joinOrg(c, org, member, 'member');
      const sec = await newProject(c, org, admin, 'private');
      await joinProject(c, sec, member);

      assert.ok((await visibleTo(c, org, member)).has(sec));
    });
  });

  it('組織管理者には、メンバーでなくても見える', async () => {
    await withRollback(async (c) => {
      const org = await newOrg(c, 'アクメ');
      const creator = await newUser(c, '作った人');
      const admin = await newUser(c, 'あとから管理者になった人');
      await joinOrg(c, org, creator, 'member');
      await joinOrg(c, org, admin, 'admin');
      const sec = await newProject(c, org, creator, 'private');
      await joinProject(c, sec, creator);

      // 退職者しかいないプロジェクトを引き継げなくなる事態を避けるため
      assert.ok((await visibleTo(c, org, admin)).has(sec));
    });
  });

  it('プロジェクトから外されたら見えなくなる', async () => {
    await withRollback(async (c) => {
      const org = await newOrg(c, 'アクメ');
      const admin = await newUser(c, '管理者');
      const member = await newUser(c, '外された人');
      await joinOrg(c, org, admin, 'admin');
      await joinOrg(c, org, member, 'member');
      const sec = await newProject(c, org, admin, 'private');
      await joinProject(c, sec, member, true); // deleted_at あり

      assert.equal((await visibleTo(c, org, member)).has(sec), false);
    });
  });
});

describe('組織から外れた人', () => {
  it('公開プロジェクトも見えなくなる', async () => {
    await withRollback(async (c) => {
      const org = await newOrg(c, 'アクメ');
      const admin = await newUser(c, '管理者');
      const gone = await newUser(c, '辞めた人');
      await joinOrg(c, org, admin, 'admin');
      await joinOrg(c, org, gone, 'member', true); // deleted_at あり
      await newProject(c, org, admin, 'public');

      assert.equal((await visibleTo(c, org, gone)).size, 0);
    });
  });

  it('プロジェクトのメンバー行が残っていても、非公開は見えない', async () => {
    await withRollback(async (c) => {
      const org = await newOrg(c, 'アクメ');
      const admin = await newUser(c, '管理者');
      const gone = await newUser(c, '辞めた人');
      await joinOrg(c, org, admin, 'admin');
      await joinOrg(c, org, gone, 'member', true);
      const sec = await newProject(c, org, admin, 'private');
      // 組織からは外したが、プロジェクトのメンバー行は残っている
      await joinProject(c, sec, gone);

      // 「外すときに両方を消す」という規律に頼らない
      assert.equal((await visibleTo(c, org, gone)).has(sec), false);
    });
  });

  it('管理者だった人でも見えなくなる', async () => {
    await withRollback(async (c) => {
      const org = await newOrg(c, 'アクメ');
      const current = await newUser(c, 'いまの管理者');
      const gone = await newUser(c, '辞めた管理者');
      await joinOrg(c, org, current, 'admin');
      await joinOrg(c, org, gone, 'admin', true);
      await newProject(c, org, current, 'private');

      assert.equal((await visibleTo(c, org, gone)).size, 0);
    });
  });
});

describe('プロジェクトの状態', () => {
  it('アーカイブ済みでも見える', async () => {
    await withRollback(async (c) => {
      const org = await newOrg(c, 'アクメ');
      const admin = await newUser(c, '管理者');
      await joinOrg(c, org, admin, 'admin');
      const archived = await newProject(c, org, admin, 'public', 'archived');

      // 読み取り専用になるだけで、閲覧はできる
      assert.ok((await visibleTo(c, org, admin)).has(archived));
    });
  });

  it('論理削除されたものは、組織管理者にも見えない', async () => {
    await withRollback(async (c) => {
      const org = await newOrg(c, 'アクメ');
      const admin = await newUser(c, '管理者');
      await joinOrg(c, org, admin, 'admin');
      const deleted = await newProject(c, org, admin, 'public', 'deleted');

      assert.equal((await visibleTo(c, org, admin)).has(deleted), false);
    });
  });
});

describe('組織の取り違え', () => {
  it('別の組織のidを渡しても、そちらのプロジェクトは出てこない', async () => {
    await withRollback(async (c) => {
      const acme = await newOrg(c, 'アクメ');
      const other = await newOrg(c, 'よその会社');
      const bothSides = await newUser(c, '両方に属する人');
      await joinOrg(c, acme, bothSides, 'admin');
      await joinOrg(c, other, bothSides, 'admin');

      const inAcme = await newProject(c, acme, bothSides, 'public');
      const inOther = await newProject(c, other, bothSides, 'public');

      // 複数の組織に属していても、混ざらない
      const seenInAcme = await visibleTo(c, acme, bothSides);
      assert.ok(seenInAcme.has(inAcme));
      assert.equal(seenInAcme.has(inOther), false);
    });
  });
});

/* ==========================================================================
   呼び出し側を通した確認

   副問い合わせが正しくても、使う側が組み込み忘れていれば漏れる。
   listThreads は pool を使うため、コミット済みのデータで確かめる。
   ここだけは巻き戻しが使えないので、最後に必ず片付ける。
   ========================================================================== */

describe('listThreads を通した確認', () => {
  it('閲覧できないプロジェクトのスレッドは返らない', async () => {
    const made: {
      org?: string;
      admin?: string;
      member?: string;
      pub?: string;
      sec?: string;
    } = {};

    try {
      const org = await value<string>(
        pool,
        'INSERT INTO organizations (name, slug) VALUES ($1,$2) RETURNING id',
        ['アクメ', `perm-int-${uniq()}`],
      );
      made.org = org;

      const admin = await value<string>(
        pool,
        'INSERT INTO users (email, display_name) VALUES ($1,$2) RETURNING id',
        [`perm-int-a-${uniq()}@example.com`, '管理者'],
      );
      const member = await value<string>(
        pool,
        'INSERT INTO users (email, display_name) VALUES ($1,$2) RETURNING id',
        [`perm-int-m-${uniq()}@example.com`, 'メンバー'],
      );
      made.admin = admin;
      made.member = member;

      await pool.query(
        'INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,$3)',
        [org, admin, 'admin'],
      );
      await pool.query(
        'INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,$3)',
        [org, member, 'member'],
      );

      const project = async (key: string, visibility: 'public' | 'private') =>
        value<string>(
          pool,
          `INSERT INTO projects (organization_id, key, name, created_by_user_id, visibility)
           VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [org, key, '検証用', admin, visibility],
        );
      const pub = await project('PUB', 'public');
      const sec = await project('SEC', 'private');
      made.pub = pub;
      made.sec = sec;

      const thread = async (projectId: string, title: string) => {
        const number = await value<string>(
          pool,
          `UPDATE organizations SET next_thread_number = next_thread_number + 1
            WHERE id = $1 RETURNING next_thread_number - 1`,
          [org],
        );
        await pool.query(
          `INSERT INTO threads (organization_id, project_id, number, type, title, created_by_user_id)
           VALUES ($1,$2,$3,'kadai',$4,$5)`,
          [org, projectId, Number(number), title, admin],
        );
      };
      await thread(pub, '公開の課題');
      await thread(sec, '秘密の課題');

      const scopeOf = (userId: string, isOrgAdmin: boolean) => ({
        organizationId: org,
        userId,
        isOrgAdmin,
        timezone: 'Asia/Tokyo',
      });

      // メンバーには公開だけが見える
      assert.equal((await listThreads(scopeOf(member, false), pub)).length, 1);
      assert.equal(
        (await listThreads(scopeOf(member, false), sec)).length,
        0,
        '非公開プロジェクトのスレッドが返った',
      );

      // 組織管理者には非公開も見える
      assert.equal((await listThreads(scopeOf(admin, true), sec)).length, 1);

      // isOrgAdmin を偽っても、判定はデータベース側で行われる
      assert.equal(
        (await listThreads(scopeOf(member, true), sec)).length,
        0,
        'scope の申告だけで非公開が見えてしまう',
      );
    } finally {
      // 外部キーの順に片付ける
      if (made.org) {
        await pool.query('DELETE FROM threads WHERE organization_id = $1', [made.org]);
      }
      for (const p of [made.pub, made.sec].filter(Boolean)) {
        await pool.query('DELETE FROM project_members WHERE project_id = $1', [p]);
        await pool.query('DELETE FROM projects WHERE id = $1', [p]);
      }
      if (made.org) {
        await pool.query('DELETE FROM organization_members WHERE organization_id = $1', [
          made.org,
        ]);
      }
      for (const u of [made.admin, made.member].filter(Boolean)) {
        await pool.query('DELETE FROM users WHERE id = $1', [u]);
      }
      if (made.org) {
        await pool.query('DELETE FROM organizations WHERE id = $1', [made.org]);
      }
    }
  });
});
