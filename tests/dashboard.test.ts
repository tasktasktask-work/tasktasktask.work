import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { listAssignedThreads } from '#features/dashboard/queries.ts';
import type { MemberRole } from '#features/organization/queries.ts';
import { type OrgScope, pool } from '#lib/db.ts';

/*
 * 担当スレッド一覧。
 *
 * この画面は、プロジェクトの壁を越えて行を集める唯一の場所である。
 * 越えたぶん、閲覧の判定が効いていることを別に確かめる必要がある。
 *
 * 並び順も確かめる。終了日が近い順で、日付を持たないものは後ろに置く。
 * 期間未設定の課題が先頭に居座ると、期限の迫った仕事が見えなくなる。
 */

const TAG = `dash-${process.pid}`;
let seq = 0;
const uniq = (): string => {
  seq += 1;
  return `${TAG}-${seq}`;
};

let keySeq = 0;
const newKey = (): string => {
  keySeq += 1;
  return `D${keySeq}`;
};

after(async () => {
  const like = `${TAG}-%`;
  const orgs = `SELECT id FROM organizations WHERE slug LIKE $1`;

  await pool.query(`DELETE FROM notifications WHERE organization_id IN (${orgs})`, [like]);
  await pool.query(`DELETE FROM threads WHERE organization_id IN (${orgs})`, [like]);
  await pool.query(
    `DELETE FROM project_members WHERE project_id IN (
       SELECT id FROM projects WHERE organization_id IN (${orgs}))`,
    [like],
  );
  await pool.query(`DELETE FROM projects WHERE organization_id IN (${orgs})`, [like]);
  await pool.query(`DELETE FROM organization_members WHERE organization_id IN (${orgs})`, [
    like,
  ]);
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [like]);
  await pool.query(`DELETE FROM organizations WHERE slug LIKE $1`, [like]);
  await pool.end();
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

type Org = { id: string; slug: string };

async function newOrg(): Promise<Org> {
  const slug = uniq();
  const id = await value('INSERT INTO organizations (name, slug) VALUES ($1,$2) RETURNING id', [
    '株式会社アクメ',
    slug,
  ]);
  return { id, slug };
}

async function member(org: Org, role: MemberRole): Promise<OrgScope> {
  const user = await value(
    'INSERT INTO users (email, display_name) VALUES ($1,$2) RETURNING id',
    [`${uniq()}@example.com`, '佐藤 明日香'],
  );
  await pool.query(
    'INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,$3)',
    [org.id, user, role],
  );
  return {
    organizationId: org.id,
    userId: user,
    isOrgAdmin: role === 'admin',
    timezone: 'Asia/Tokyo',
    frozen: false,
  };
}

function faked(scope: OrgScope): OrgScope {
  return { ...scope, isOrgAdmin: true };
}

async function newProject(
  org: Org,
  creator: string,
  options: { visibility?: 'public' | 'private'; archived?: boolean } = {},
): Promise<{ id: string; key: string }> {
  const key = newKey();
  const id = await value(
    `INSERT INTO projects
       (organization_id, key, name, visibility, created_by_user_id, archived_at)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [
      org.id,
      key,
      '検索基盤の刷新',
      options.visibility ?? 'public',
      creator,
      options.archived ? new Date() : null,
    ],
  );
  return { id, key };
}

type ThreadOptions = {
  title?: string;
  type?: 'kadai' | 'giron' | 'shitsumon';
  assignee?: string | null;
  progress?: number;
  startsOn?: string | null;
  endsOn?: string | null;
  archived?: boolean;
};

async function addThread(
  org: Org,
  projectId: string,
  creator: string,
  options: ThreadOptions = {},
): Promise<string> {
  const number = Number(
    await value<string>(
      `UPDATE organizations SET next_thread_number = next_thread_number + 1
        WHERE id = $1 RETURNING next_thread_number - 1`,
      [org.id],
    ),
  );
  return value(
    `INSERT INTO threads
       (organization_id, project_id, number, type, title, body,
        assignee_user_id, progress, starts_on, ends_on, created_by_user_id, archived_at)
     VALUES ($1,$2,$3,$4,$5,'',$6,$7,$8,$9,$10,$11) RETURNING id`,
    [
      org.id,
      projectId,
      number,
      options.type ?? 'kadai',
      options.title ?? '検索APIの実装',
      options.assignee ?? null,
      options.progress ?? 0,
      options.startsOn ?? null,
      options.endsOn ?? null,
      creator,
      options.archived ? new Date() : null,
    ],
  );
}

/** 今日から数えた日付。組織のタイムゾーンで数える。 */
function day(offset: number): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 3600_000 + offset * 86_400_000);
  return jst.toISOString().slice(0, 10);
}

async function stage(options: { visibility?: 'public' | 'private' } = {}) {
  const org = await newOrg();
  const me = await member(org, 'member');
  const admin = await member(org, 'admin');
  const project = await newProject(org, admin.userId, options);
  if (options.visibility === 'private') {
    await pool.query('INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)', [
      project.id,
      me.userId,
    ]);
  }
  return { org, me, admin, project };
}

const titles = (rows: { title: string }[]): string[] => rows.map((row) => row.title);

/* --------------------------------------------------------------------------
   何が並ぶか
   -------------------------------------------------------------------------- */

describe('並べるもの', () => {
  it('自分が担当のものだけ', async () => {
    const { org, me, admin, project } = await stage();
    await addThread(org, project.id, admin.userId, { title: 'わたしの', assignee: me.userId });
    await addThread(org, project.id, admin.userId, { title: '他人の', assignee: admin.userId });
    await addThread(org, project.id, admin.userId, { title: '担当なし' });

    assert.deepEqual(titles(await listAssignedThreads(me)), ['わたしの']);
  });

  it('完了したものは、切り替えるまで出ない', async () => {
    const { org, me, admin, project } = await stage();
    await addThread(org, project.id, admin.userId, { title: '途中', assignee: me.userId });
    await addThread(org, project.id, admin.userId, {
      title: '終わった',
      assignee: me.userId,
      progress: 100,
    });

    assert.deepEqual(titles(await listAssignedThreads(me)), ['途中']);
    const both = titles(await listAssignedThreads(me, { includeCompleted: true }));
    assert.deepEqual(both.sort(), ['途中', '終わった'].sort());
  });

  it('畳んだスレッドは、切り替えても出ない', async () => {
    const { org, me, admin, project } = await stage();
    await addThread(org, project.id, admin.userId, {
      title: '畳んだ',
      assignee: me.userId,
      archived: true,
    });

    // 終わった仕事ではなく、片付いた場所である。切り替えの対象にしない
    assert.deepEqual(await listAssignedThreads(me), []);
    assert.deepEqual(await listAssignedThreads(me, { includeCompleted: true }), []);
  });

  it('畳んだプロジェクトの中身も出ない', async () => {
    const { org, me, admin, project } = await stage();
    await addThread(org, project.id, admin.userId, { title: '中身', assignee: me.userId });
    await pool.query(`UPDATE projects SET archived_at = now() WHERE id = $1`, [project.id]);

    assert.deepEqual(await listAssignedThreads(me), []);
  });

  it('消されたスレッドは出ない', async () => {
    const { org, me, admin, project } = await stage();
    const id = await addThread(org, project.id, admin.userId, {
      title: '消した',
      assignee: me.userId,
    });
    await pool.query(
      `UPDATE threads SET archived_at = now(), deleted_at = now() WHERE id = $1`,
      [id],
    );

    assert.deepEqual(await listAssignedThreads(me), []);
  });
});

describe('閲覧できる範囲', () => {
  it('見えなくなったプロジェクトの担当は出ない', async () => {
    const { org, me, admin, project } = await stage({ visibility: 'private' });
    await addThread(org, project.id, admin.userId, { title: '社外秘', assignee: me.userId });

    assert.deepEqual(titles(await listAssignedThreads(me)), ['社外秘']);

    // 担当のまま、プロジェクトから外される経路がある
    await pool.query(
      `UPDATE project_members SET deleted_at = now() WHERE project_id = $1 AND user_id = $2`,
      [project.id, me.userId],
    );
    assert.deepEqual(await listAssignedThreads(me), []);
    assert.deepEqual(await listAssignedThreads(faked(me)), []);
  });

  it('組織から外れると、何も出ない', async () => {
    const { org, me, admin, project } = await stage();
    await addThread(org, project.id, admin.userId, { title: '担当', assignee: me.userId });

    await pool.query(
      `UPDATE organization_members SET deleted_at = now()
        WHERE organization_id = $1 AND user_id = $2`,
      [org.id, me.userId],
    );
    assert.deepEqual(await listAssignedThreads(me), []);
  });

  it('組織管理者には、非公開の自分の担当も出る', async () => {
    const { org, admin, project } = await stage({ visibility: 'private' });
    await addThread(org, project.id, admin.userId, { title: '社外秘', assignee: admin.userId });

    assert.deepEqual(titles(await listAssignedThreads(admin)), ['社外秘']);
  });
});

describe('並び順と残り日数', () => {
  it('終了日の近い順で、日付の無いものは後ろ', async () => {
    const { org, me, admin, project } = await stage();
    await addThread(org, project.id, admin.userId, {
      title: '遠い',
      assignee: me.userId,
      startsOn: day(1),
      endsOn: day(12),
    });
    await addThread(org, project.id, admin.userId, { title: '日付なし', assignee: me.userId });
    await addThread(org, project.id, admin.userId, {
      title: '近い',
      assignee: me.userId,
      startsOn: day(0),
      endsOn: day(3),
    });

    assert.deepEqual(titles(await listAssignedThreads(me)), ['近い', '遠い', '日付なし']);
  });

  it('残り日数を数える', async () => {
    const { org, me, admin, project } = await stage();
    await addThread(org, project.id, admin.userId, {
      title: '三日後',
      assignee: me.userId,
      startsOn: day(0),
      endsOn: day(3),
    });
    await addThread(org, project.id, admin.userId, { title: '期間なし', assignee: me.userId });
    await addThread(org, project.id, admin.userId, {
      title: '過ぎた',
      assignee: me.userId,
      startsOn: day(-10),
      endsOn: day(-2),
    });

    const rows = await listAssignedThreads(me);
    assert.deepEqual(
      rows.map((row) => [row.title, row.daysLeft]),
      [
        ['過ぎた', -2],
        ['三日後', 3],
        ['期間なし', null],
      ],
    );
  });

  it('日付は組織のタイムゾーンで数える', async () => {
    const { org, me, admin, project } = await stage();
    await addThread(org, project.id, admin.userId, {
      title: '今日まで',
      assignee: me.userId,
      startsOn: day(0),
      endsOn: day(0),
    });

    // コンテナは UTC で動く。JST で数えた「今日」と揃っていること
    const [row] = await listAssignedThreads(me);
    assert.equal(row?.daysLeft, 0);
  });
});
