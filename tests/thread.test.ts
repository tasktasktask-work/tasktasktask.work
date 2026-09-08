import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import type { MemberRole } from '#features/organization/queries.ts';
import {
  createThread,
  deleteThread,
  editThreadText,
  listChildren,
  listThreads,
  resolveThread,
  setAssignee,
  setParent,
  setPeriod,
  setProgress,
  setThreadArchived,
  type ThreadType,
} from '#features/thread/queries.ts';
import { type OrgScope, pool } from '#lib/db.ts';

/*
 * スレッドはこのプロダクトの基本単位である。
 *
 * 閲覧の判定そのものは tests/permission.test.ts が固定している。
 * ここで確かめるのは、その判定を使う側が判定を飛び越えないことと、
 * 種別ごとの制約と、親子が輪にならないことである。
 *
 * 誰が書けるかは、閲覧できるかどうかと同じにしてある。
 * 「見えている人は書ける」を確かめると同時に、
 * 「見えていない人は書けない」を偽のスコープで確かめる。
 */

const TAG = `thrd-${process.pid}`;
let seq = 0;
const uniq = (): string => {
  seq += 1;
  return `${TAG}-${seq}`;
};

/** キーは英大文字と数字しか使えないので、印を付けられない。組織ごと消す。 */
let keySeq = 0;
const newKey = (): string => {
  keySeq += 1;
  return `T${keySeq}`;
};

after(async () => {
  const like = `${TAG}-%`;
  const inOrg = `organization_id IN (SELECT id FROM organizations WHERE slug LIKE $1)`;
  // 担当者を設定すると通知の行が立つ。スレッドより先に消す。
  await pool.query(`DELETE FROM notifications WHERE ${inOrg}`, [like]);
  await pool.query(`DELETE FROM threads WHERE ${inOrg}`, [like]);
  await pool.query(
    `DELETE FROM project_members WHERE project_id IN (
       SELECT p.id FROM projects p
        JOIN organizations o ON o.id = p.organization_id
       WHERE o.slug LIKE $1)`,
    [like],
  );
  await pool.query(`DELETE FROM projects WHERE ${inOrg}`, [like]);
  await pool.query(`DELETE FROM organization_members WHERE ${inOrg}`, [like]);
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

async function newUser(name: string): Promise<string> {
  return value('INSERT INTO users (email, display_name) VALUES ($1,$2) RETURNING id', [
    `${uniq()}@example.com`,
    name,
  ]);
}

async function member(org: Org, role: MemberRole, name = '佐藤 明日香'): Promise<OrgScope> {
  const user = await newUser(name);
  await pool.query(
    'INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,$3)',
    [org.id, user, role],
  );
  return {
    organizationId: org.id,
    userId: user,
    isOrgAdmin: role === 'admin',
    timezone: 'Asia/Tokyo',
  };
}

/** 呼ぶ側が偽ったスコープ。SQL 側が信用しないことを確かめるために使う。 */
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

/** 画面を通さずにスレッドを置く。作成そのものを試す場所以外で使う。 */
async function addThread(
  org: Org,
  projectId: string,
  creator: string,
  type: ThreadType,
  extra: Record<string, unknown> = {},
): Promise<{ id: string; number: number }> {
  const number = Number(
    await value<string>(
      `UPDATE organizations SET next_thread_number = next_thread_number + 1
        WHERE id = $1 RETURNING next_thread_number - 1`,
      [org.id],
    ),
  );
  const columns = [
    'organization_id',
    'project_id',
    'number',
    'type',
    'title',
    'created_by_user_id',
    ...Object.keys(extra),
  ];
  const values = [
    org.id,
    projectId,
    number,
    type,
    '検索の設計',
    creator,
    ...Object.values(extra),
  ];
  const id = await value(
    `INSERT INTO threads (${columns.join(',')})
     VALUES (${values.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
    values,
  );
  return { id, number };
}

async function readThread(
  id: string,
): Promise<Record<string, unknown> & { archived_at: Date | null; deleted_at: Date | null }> {
  const { rows } = await pool.query('SELECT * FROM threads WHERE id = $1', [id]);
  const row = rows[0];
  if (!row) {
    throw new Error('スレッドが見つかりません');
  }
  return row as never;
}

async function parentOf(id: string): Promise<string | null> {
  const { rows } = await pool.query<{ parent_thread_id: string | null }>(
    'SELECT parent_thread_id FROM threads WHERE id = $1',
    [id],
  );
  return rows[0]?.parent_thread_id ?? null;
}

/* --------------------------------------------------------------------------
   一覧
   -------------------------------------------------------------------------- */

describe('スレッドの一覧', () => {
  it('見えるプロジェクトのスレッドが並ぶ', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const plain = await member(org, 'member');
    const project = await newProject(org, admin.userId);
    await addThread(org, project.id, admin.userId, 'kadai');

    assert.equal((await listThreads(plain, project.id)).length, 1);
  });

  it('非公開プロジェクトのスレッドは、メンバーでない人には並ばない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const plain = await member(org, 'member');
    const project = await newProject(org, admin.userId, { visibility: 'private' });
    await addThread(org, project.id, admin.userId, 'kadai');

    // 偽って組織管理者を名乗っても増えない。判定は SQL の中にある。
    assert.equal((await listThreads(faked(plain), project.id)).length, 0);
  });

  it('完了したものは既定で隠れ、切り替えれば出る', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    await addThread(org, project.id, admin.userId, 'kadai', { progress: 100 });
    await addThread(org, project.id, admin.userId, 'kadai', { progress: 40 });

    assert.equal((await listThreads(admin, project.id)).length, 1);
    assert.equal((await listThreads(admin, project.id, { includeCompleted: true })).length, 2);
  });

  it('アーカイブ済みは既定で隠れる', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    await addThread(org, project.id, admin.userId, 'kadai', { archived_at: new Date() });

    assert.equal((await listThreads(admin, project.id)).length, 0);
    assert.equal((await listThreads(admin, project.id, { includeArchived: true })).length, 1);
  });

  it('アーカイブ済みでも、活動中の子を持つものは残る', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    const parent = await addThread(org, project.id, admin.userId, 'kadai', {
      archived_at: new Date(),
    });
    await addThread(org, project.id, admin.userId, 'kadai', { parent_thread_id: parent.id });

    // 親が畳まれても、動いている子が親ごと視界から消えることはない
    const numbers = (await listThreads(admin, project.id)).map((t) => t.number).sort();
    assert.deepEqual(numbers, [parent.number, parent.number + 1]);
  });

  it('種別で絞り込める', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    await addThread(org, project.id, admin.userId, 'kadai');
    await addThread(org, project.id, admin.userId, 'giron');

    const rows = await listThreads(admin, project.id, { type: 'giron' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.type, 'giron');
  });

  it('担当者で絞り込める。未設定だけを出すこともできる', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const ryo = await member(org, 'member', '田中 亮');
    const project = await newProject(org, admin.userId);
    await addThread(org, project.id, admin.userId, 'kadai', { assignee_user_id: ryo.userId });
    await addThread(org, project.id, admin.userId, 'kadai');

    assert.equal(
      (await listThreads(admin, project.id, { assigneeUserId: ryo.userId })).length,
      1,
    );
    const none = await listThreads(admin, project.id, { unassigned: true });
    assert.equal(none.length, 1);
    assert.equal(none[0]?.assigneeName, null);
  });

  it('親の期間からはみ出している子に印が付く', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    const parent = await addThread(org, project.id, admin.userId, 'kadai', {
      starts_on: '2026-09-01',
      ends_on: '2026-09-30',
    });
    await addThread(org, project.id, admin.userId, 'kadai', {
      parent_thread_id: parent.id,
      starts_on: '2026-09-10',
      ends_on: '2026-10-15',
    });
    await addThread(org, project.id, admin.userId, 'kadai', {
      parent_thread_id: parent.id,
      starts_on: '2026-09-10',
      ends_on: '2026-09-20',
    });

    const rows = await listThreads(admin, project.id);
    const out = rows.filter((row) => row.overflow).map((row) => row.number);
    assert.deepEqual(out, [parent.number + 1]);
  });

  it('親に期間が無ければ、はみ出しようがない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    const parent = await addThread(org, project.id, admin.userId, 'giron');
    await addThread(org, project.id, admin.userId, 'kadai', {
      parent_thread_id: parent.id,
      starts_on: '2026-09-10',
      ends_on: '2026-10-15',
    });

    assert.equal(
      (await listThreads(admin, project.id)).every((row) => row.overflow === false),
      true,
    );
  });

  it('子スレッドは、畳んだものも完了したものも並ぶ', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    const parent = await addThread(org, project.id, admin.userId, 'giron');
    await addThread(org, project.id, admin.userId, 'kadai', {
      parent_thread_id: parent.id,
      progress: 100,
    });
    await addThread(org, project.id, admin.userId, 'kadai', {
      parent_thread_id: parent.id,
      archived_at: new Date(),
    });

    assert.equal((await listChildren(admin, parent.id)).length, 2);
  });

  it('子スレッドの一覧も、見えないプロジェクトでは空になる', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const plain = await member(org, 'member');
    const project = await newProject(org, admin.userId, { visibility: 'private' });
    const parent = await addThread(org, project.id, admin.userId, 'giron');
    await addThread(org, project.id, admin.userId, 'kadai', { parent_thread_id: parent.id });

    assert.equal((await listChildren(faked(plain), parent.id)).length, 0);
  });
});

/* --------------------------------------------------------------------------
   一件を引く
   -------------------------------------------------------------------------- */

describe('スレッドを引く', () => {
  it('プロジェクトと番号で引ける', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    const thread = await addThread(org, project.id, admin.userId, 'kadai');

    const found = await resolveThread(admin, project.id, thread.number);
    assert.equal(found?.id, thread.id);
    assert.equal(found?.projectKey, project.key);
  });

  it('番号が合っていても、別のプロジェクトからは引けない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const web = await newProject(org, admin.userId);
    const bill = await newProject(org, admin.userId);
    const thread = await addThread(org, web.id, admin.userId, 'kadai');

    assert.equal(await resolveThread(admin, bill.id, thread.number), null);
  });

  it('見えないプロジェクトのスレッドは引けない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const plain = await member(org, 'member');
    const project = await newProject(org, admin.userId, { visibility: 'private' });
    const thread = await addThread(org, project.id, admin.userId, 'kadai');

    assert.equal(await resolveThread(faked(plain), project.id, thread.number), null);
  });

  it('親と子の数が付いてくる', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    const parent = await addThread(org, project.id, admin.userId, 'giron');
    const child = await addThread(org, project.id, admin.userId, 'kadai', {
      parent_thread_id: parent.id,
    });

    const top = await resolveThread(admin, project.id, parent.number);
    assert.equal(top?.childCount, 1);
    const below = await resolveThread(admin, project.id, child.number);
    assert.equal(below?.parentNumber, parent.number);
  });

  it('子がはみ出していれば、親の側にも印が立つ', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    const parent = await addThread(org, project.id, admin.userId, 'kadai', {
      starts_on: '2026-09-01',
      ends_on: '2026-09-30',
    });
    await addThread(org, project.id, admin.userId, 'kadai', {
      parent_thread_id: parent.id,
      starts_on: '2026-09-10',
      ends_on: '2026-10-15',
    });

    const top = await resolveThread(admin, project.id, parent.number);
    assert.equal(top?.childOverflow, true);
    assert.equal(top?.overflow, false);
  });

  it('プロジェクトごと畳まれていることが分かる', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId, { archived: true });
    const thread = await addThread(org, project.id, admin.userId, 'kadai');

    const found = await resolveThread(admin, project.id, thread.number);
    assert.equal(found?.archived, false);
    assert.equal(found?.projectArchived, true);
  });
});

/* --------------------------------------------------------------------------
   立てる
   -------------------------------------------------------------------------- */

describe('スレッドを立てる', () => {
  const base = {
    title: '検索APIの実装',
    body: '前方一致から始める',
    parentNumber: null,
    assigneeUserId: null,
    startsOn: null,
    endsOn: null,
    tagIds: [],
  };

  it('プロジェクトが見えていれば、組織管理者でなくても立てられる', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const plain = await member(org, 'member', '田中 亮');
    const project = await newProject(org, admin.userId);

    const result = await createThread(plain, project.id, { ...base, type: 'giron' });
    assert.equal(result.ok, true);
  });

  it('見えないプロジェクトには立てられない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const plain = await member(org, 'member');
    const project = await newProject(org, admin.userId, { visibility: 'private' });

    const result = await createThread(faked(plain), project.id, { ...base, type: 'kadai' });
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, 'not-found');
  });

  it('アーカイブ済みのプロジェクトには立てられない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId, { archived: true });

    const result = await createThread(admin, project.id, { ...base, type: 'kadai' });
    assert.equal(result.ok, false);
  });

  it('番号は組織の中で通しになる', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const web = await newProject(org, admin.userId);
    const bill = await newProject(org, admin.userId);

    const first = await createThread(admin, web.id, { ...base, type: 'kadai' });
    const second = await createThread(admin, bill.id, { ...base, type: 'kadai' });
    const third = await createThread(admin, web.id, { ...base, type: 'kadai' });

    assert.equal(first.ok && second.ok && third.ok, true);
    if (first.ok && second.ok && third.ok) {
      // 別プロジェクトが間の番号を使う。ひとつのプロジェクトから見ると飛ぶ
      assert.equal(second.number, first.number + 1);
      assert.equal(third.number, first.number + 2);
    }
  });

  it('タイトルが空なら断る', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);

    const result = await createThread(admin, project.id, {
      ...base,
      type: 'kadai',
      title: '   ',
    });
    assert.equal(result.ok === false && result.reason, 'invalid-title');
  });

  it('課題以外は期間を持てない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);

    const result = await createThread(admin, project.id, {
      ...base,
      type: 'giron',
      startsOn: '2026-09-01',
      endsOn: '2026-09-30',
    });
    assert.equal(result.ok === false && result.reason, 'period-not-allowed');
  });

  it('期間は片方だけでは入れられない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);

    const result = await createThread(admin, project.id, {
      ...base,
      type: 'kadai',
      startsOn: '2026-09-01',
    });
    assert.equal(result.ok === false && result.reason, 'invalid-period');
  });

  it('親は同じプロジェクトのものに限る', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const web = await newProject(org, admin.userId);
    const bill = await newProject(org, admin.userId);
    const outside = await addThread(org, bill.id, admin.userId, 'giron');

    const result = await createThread(admin, web.id, {
      ...base,
      type: 'kadai',
      parentNumber: outside.number,
    });
    assert.equal(result.ok === false && result.reason, 'parent-not-found');
  });

  it('アーカイブ済みのスレッドは親にできない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    const parent = await addThread(org, project.id, admin.userId, 'giron', {
      archived_at: new Date(),
    });

    const result = await createThread(admin, project.id, {
      ...base,
      type: 'kadai',
      parentNumber: parent.number,
    });
    assert.equal(result.ok === false && result.reason, 'parent-archived');
  });

  it('組織の外の人は担当者に置けない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    const stranger = await newUser('他社の人');

    const result = await createThread(admin, project.id, {
      ...base,
      type: 'kadai',
      assigneeUserId: stranger,
    });
    assert.equal(result.ok === false && result.reason, 'not-org-member');
  });
});

/* --------------------------------------------------------------------------
   書き換える
   -------------------------------------------------------------------------- */

describe('スレッドを書き換える', () => {
  it('見えている人なら、立てた人でなくても書き換えられる', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const plain = await member(org, 'member', '田中 亮');
    const project = await newProject(org, admin.userId);
    const thread = await addThread(org, project.id, admin.userId, 'kadai');

    assert.equal((await editThreadText(plain, thread.id, '新しい題', '本文')).ok, true);
    const row = await readThread(thread.id);
    assert.equal(row.title, '新しい題');
    // 履歴は残さない。残すのは印と時刻だけである
    assert.notEqual(row.body_edited_at, null);
  });

  it('見えないプロジェクトのスレッドは書き換えられない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const plain = await member(org, 'member');
    const project = await newProject(org, admin.userId, { visibility: 'private' });
    const thread = await addThread(org, project.id, admin.userId, 'kadai');

    const result = await editThreadText(faked(plain), thread.id, '乗っ取り', '');
    assert.equal(result.ok, false);
    assert.equal((await readThread(thread.id)).title, '検索の設計');
  });

  it('アーカイブ済みは読み取り専用になる', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    const thread = await addThread(org, project.id, admin.userId, 'kadai', {
      archived_at: new Date(),
    });

    const result = await editThreadText(admin, thread.id, '新しい題', '');
    assert.equal(result.ok === false && result.reason, 'archived');
  });

  it('プロジェクトごと畳まれていれば、中のスレッドも書けない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId, { archived: true });
    const thread = await addThread(org, project.id, admin.userId, 'kadai');

    // 個々の archived_at は立っていない。プロジェクトの側だけで止める
    const row = await readThread(thread.id);
    assert.equal(row.archived_at, null);
    const result = await editThreadText(admin, thread.id, '新しい題', '');
    assert.equal(result.ok === false && result.reason, 'project-archived');
  });

  it('タイトルを空にはできない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    const thread = await addThread(org, project.id, admin.userId, 'kadai');

    const result = await editThreadText(admin, thread.id, '  ', '');
    assert.equal(result.ok === false && result.reason, 'invalid-title');
  });

  it('課題の進捗率は1刻みで入る', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    const thread = await addThread(org, project.id, admin.userId, 'kadai');

    assert.equal((await setProgress(admin, thread.id, 37)).ok, true);
    assert.equal((await readThread(thread.id)).progress, 37);
  });

  it('議論と質問は0か100しか取らない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    const thread = await addThread(org, project.id, admin.userId, 'giron');

    const result = await setProgress(admin, thread.id, 40);
    assert.equal(result.ok === false && result.reason, 'invalid-progress');
    assert.equal((await setProgress(admin, thread.id, 100)).ok, true);
  });

  it('担当者を付けて、外せる', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const ryo = await member(org, 'member', '田中 亮');
    const project = await newProject(org, admin.userId);
    const thread = await addThread(org, project.id, admin.userId, 'kadai');

    assert.equal((await setAssignee(admin, thread.id, ryo.userId)).ok, true);
    assert.equal((await readThread(thread.id)).assignee_user_id, ryo.userId);
    assert.equal((await setAssignee(admin, thread.id, null)).ok, true);
    assert.equal((await readThread(thread.id)).assignee_user_id, null);
  });

  it('組織から外れた人は担当者に置けない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const ryo = await member(org, 'member', '田中 亮');
    const project = await newProject(org, admin.userId);
    const thread = await addThread(org, project.id, admin.userId, 'kadai');
    await pool.query(
      'UPDATE organization_members SET deleted_at = now() WHERE organization_id=$1 AND user_id=$2',
      [org.id, ryo.userId],
    );

    const result = await setAssignee(admin, thread.id, ryo.userId);
    assert.equal(result.ok === false && result.reason, 'not-org-member');
  });

  it('期間を入れて、外せる', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    const thread = await addThread(org, project.id, admin.userId, 'kadai');

    const set = await setPeriod(admin, thread.id, {
      startsOn: '2026-09-08',
      endsOn: '2026-09-19',
    });
    assert.equal(set.ok, true);
    assert.equal((await readThread(thread.id)).starts_on, '2026-09-08');

    assert.equal(
      (await setPeriod(admin, thread.id, { startsOn: null, endsOn: null })).ok,
      true,
    );
    assert.equal((await readThread(thread.id)).starts_on, null);
  });

  it('終了日が開始日より前なら断る', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    const thread = await addThread(org, project.id, admin.userId, 'kadai');

    const result = await setPeriod(admin, thread.id, {
      startsOn: '2026-09-19',
      endsOn: '2026-09-08',
    });
    assert.equal(result.ok === false && result.reason, 'invalid-period');
  });

  it('議論に期間は入れられない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    const thread = await addThread(org, project.id, admin.userId, 'giron');

    const result = await setPeriod(admin, thread.id, {
      startsOn: '2026-09-08',
      endsOn: '2026-09-19',
    });
    assert.equal(result.ok === false && result.reason, 'period-not-allowed');
  });

  it('親からはみ出す期間でも保存できる', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    const parent = await addThread(org, project.id, admin.userId, 'kadai', {
      starts_on: '2026-09-01',
      ends_on: '2026-09-30',
    });
    const child = await addThread(org, project.id, admin.userId, 'kadai', {
      parent_thread_id: parent.id,
    });

    // 止めると、親の締切を延ばすまで子の日付を入れられなくなる
    const result = await setPeriod(admin, child.id, {
      startsOn: '2026-09-10',
      endsOn: '2026-10-15',
    });
    assert.equal(result.ok, true);
    const row = await resolveThread(admin, project.id, child.number);
    assert.equal(row?.overflow, true);
  });
});

/* --------------------------------------------------------------------------
   親子
   -------------------------------------------------------------------------- */

describe('親子関係', () => {
  it('番号で親を指して、外せる', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    const parent = await addThread(org, project.id, admin.userId, 'giron');
    const child = await addThread(org, project.id, admin.userId, 'kadai');

    assert.equal((await setParent(admin, child.id, parent.number)).ok, true);
    assert.equal(await parentOf(child.id), parent.id);
    assert.equal((await setParent(admin, child.id, null)).ok, true);
    assert.equal(await parentOf(child.id), null);
  });

  it('自分を親にはできない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    const thread = await addThread(org, project.id, admin.userId, 'kadai');

    const result = await setParent(admin, thread.id, thread.number);
    assert.equal(result.ok === false && result.reason, 'parent-cycle');
  });

  it('輪になる付け替えは断る', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    const top = await addThread(org, project.id, admin.userId, 'giron');
    const middle = await addThread(org, project.id, admin.userId, 'kadai', {
      parent_thread_id: top.id,
    });
    const bottom = await addThread(org, project.id, admin.userId, 'kadai', {
      parent_thread_id: middle.id,
    });

    // 祖先を辿ると自分が現れる。CHECK 制約では書けない条件である
    const result = await setParent(admin, top.id, bottom.number);
    assert.equal(result.ok === false && result.reason, 'parent-cycle');
    assert.equal(await parentOf(top.id), null);
  });

  it('別のプロジェクトのスレッドは親にできない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const web = await newProject(org, admin.userId);
    const bill = await newProject(org, admin.userId);
    const outside = await addThread(org, bill.id, admin.userId, 'giron');
    const child = await addThread(org, web.id, admin.userId, 'kadai');

    const result = await setParent(admin, child.id, outside.number);
    assert.equal(result.ok === false && result.reason, 'parent-not-found');
  });

  it('種別はまたげる', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    const giron = await addThread(org, project.id, admin.userId, 'giron');
    const kadai = await addThread(org, project.id, admin.userId, 'kadai');
    const shitsumon = await addThread(org, project.id, admin.userId, 'shitsumon');

    assert.equal((await setParent(admin, kadai.id, giron.number)).ok, true);
    assert.equal((await setParent(admin, shitsumon.id, kadai.number)).ok, true);
  });

  it('見えないプロジェクトでは付け替えられない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const plain = await member(org, 'member');
    const project = await newProject(org, admin.userId, { visibility: 'private' });
    const parent = await addThread(org, project.id, admin.userId, 'giron');
    const child = await addThread(org, project.id, admin.userId, 'kadai');

    assert.equal((await setParent(faked(plain), child.id, parent.number)).ok, false);
    assert.equal(await parentOf(child.id), null);
  });
});

/* --------------------------------------------------------------------------
   アーカイブと削除
   -------------------------------------------------------------------------- */

describe('アーカイブと削除', () => {
  it('見えている人なら畳めるし、戻せる', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const plain = await member(org, 'member', '田中 亮');
    const project = await newProject(org, admin.userId);
    const thread = await addThread(org, project.id, admin.userId, 'kadai');

    assert.equal((await setThreadArchived(plain, thread.id, true)).ok, true);
    assert.notEqual((await readThread(thread.id)).archived_at, null);
    assert.equal((await setThreadArchived(plain, thread.id, false)).ok, true);
    assert.equal((await readThread(thread.id)).archived_at, null);
  });

  it('畳んでも子は連鎖しない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    const parent = await addThread(org, project.id, admin.userId, 'giron');
    const child = await addThread(org, project.id, admin.userId, 'kadai', {
      parent_thread_id: parent.id,
    });

    await setThreadArchived(admin, parent.id, true);
    assert.equal((await readThread(child.id)).archived_at, null);
  });

  it('見えないプロジェクトでは畳めない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const plain = await member(org, 'member');
    const project = await newProject(org, admin.userId, { visibility: 'private' });
    const thread = await addThread(org, project.id, admin.userId, 'kadai');

    assert.equal((await setThreadArchived(faked(plain), thread.id, true)).ok, false);
    assert.equal((await readThread(thread.id)).archived_at, null);
  });

  it('削除できるのは組織管理者だけ', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const plain = await member(org, 'member', '田中 亮');
    const project = await newProject(org, admin.userId);
    const thread = await addThread(org, project.id, admin.userId, 'kadai', {
      archived_at: new Date(),
    });

    // 偽って組織管理者を名乗っても通らない
    const result = await deleteThread(faked(plain), thread.id);
    assert.equal(result.ok === false && result.reason, 'forbidden');
    assert.equal((await readThread(thread.id)).deleted_at, null);
  });

  it('アーカイブを経ていないものは削除できない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    const thread = await addThread(org, project.id, admin.userId, 'kadai');

    const result = await deleteThread(admin, thread.id);
    assert.equal(result.ok === false && result.reason, 'not-archived');
  });

  it('削除しても番号は欠番のまま残る', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    const thread = await addThread(org, project.id, admin.userId, 'kadai', {
      archived_at: new Date(),
    });

    assert.equal((await deleteThread(admin, thread.id)).ok, true);
    assert.notEqual((await readThread(thread.id)).deleted_at, null);
    // 引けなくなるが、行は残っているので番号は使い回されない
    assert.equal(await resolveThread(admin, project.id, thread.number), null);
    assert.equal((await listThreads(admin, project.id, { includeArchived: true })).length, 0);
  });
});
