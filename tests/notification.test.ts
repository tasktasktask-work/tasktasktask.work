import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { postComment } from '#features/comment/queries.ts';
import {
  countUnread,
  isWatching,
  listNotifications,
  markAllRead,
  openNotification,
  READ_LIMIT,
  setWatch,
} from '#features/notification/queries.ts';
import type { MemberRole } from '#features/organization/queries.ts';
import { createThread, setAssignee, setThreadArchived } from '#features/thread/queries.ts';
import { type OrgScope, pool } from '#lib/db.ts';

/*
 * 通知とウォッチ。
 *
 * 確かめたいのは四つある。
 *
 * 一つめは、宛先が閲覧できる範囲を越えないこと。
 * ウォッチの行はプロジェクトが非公開に変わっても残る。
 * 絞らなければ、読めないスレッドの題名を含む通知が届く。
 * 書く側と読む側の両方で絞るので、両方を別々に壊して確かめる。
 *
 * 二つめは、同じ出来事で二度知らせないこと。
 * 三つめは、既読が自分の行にしか効かないこと。
 * 四つめは、ウォッチが自動では付かないこと。
 */

const TAG = `noti-${process.pid}`;
let seq = 0;
const uniq = (): string => {
  seq += 1;
  return `${TAG}-${seq}`;
};

let keySeq = 0;
const newKey = (): string => {
  keySeq += 1;
  return `N${keySeq}`;
};

after(async () => {
  const like = `${TAG}-%`;
  const orgs = `SELECT id FROM organizations WHERE slug LIKE $1`;
  const threads = `SELECT id FROM threads WHERE organization_id IN (${orgs})`;
  const comments = `SELECT id FROM comments WHERE organization_id IN (${orgs})`;

  await pool.query(`DELETE FROM notifications WHERE organization_id IN (${orgs})`, [like]);
  await pool.query(`DELETE FROM comment_mentions WHERE comment_id IN (${comments})`, [like]);
  await pool.query(`DELETE FROM comment_checks WHERE comment_id IN (${comments})`, [like]);
  await pool.query(`DELETE FROM comments WHERE organization_id IN (${orgs})`, [like]);
  await pool.query(`DELETE FROM watches WHERE thread_id IN (${threads})`, [like]);
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

async function member(org: Org, role: MemberRole, name = '佐藤 明日香'): Promise<OrgScope> {
  const user = await value(
    'INSERT INTO users (email, display_name) VALUES ($1,$2) RETURNING id',
    [`${uniq()}@example.com`, name],
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

async function addThread(
  org: Org,
  projectId: string,
  creator: string,
): Promise<{ id: string; number: number }> {
  const number = Number(
    await value<string>(
      `UPDATE organizations SET next_thread_number = next_thread_number + 1
        WHERE id = $1 RETURNING next_thread_number - 1`,
      [org.id],
    ),
  );
  const id = await value(
    `INSERT INTO threads
       (organization_id, project_id, number, type, title, body, created_by_user_id)
     VALUES ($1,$2,$3,'kadai','検索の設計','',$4) RETURNING id`,
    [org.id, projectId, number, creator],
  );
  return { id, number };
}

/** 公開プロジェクトにスレッドが一本。管理者と一般の二人。 */
async function stage(options: { visibility?: 'public' | 'private' } = {}) {
  const org = await newOrg();
  const admin = await member(org, 'admin', '佐藤 明日香');
  const other = await member(org, 'member', '田中 亮');
  const project = await newProject(org, admin.userId, options);
  if (options.visibility === 'private') {
    await pool.query('INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)', [
      project.id,
      other.userId,
    ]);
  }
  const thread = await addThread(org, project.id, admin.userId);
  return { org, admin, other, project, thread };
}

async function rowsFor(threadId: string) {
  const { rows } = await pool.query<{ user_id: string; kind: string }>(
    `SELECT user_id, kind FROM notifications WHERE thread_id = $1 ORDER BY kind, user_id`,
    [threadId],
  );
  return rows;
}

/** 直に一行積む。読む側だけを確かめたいときに使う。 */
async function plant(
  org: Org,
  to: OrgScope,
  threadId: string,
  options: { actor?: string; read?: boolean; at?: string } = {},
): Promise<string> {
  return value(
    `INSERT INTO notifications
       (organization_id, user_id, kind, thread_id, actor_user_id, read_at, created_at)
     VALUES ($1,$2,'assigned',$3,$4,$5,COALESCE($6::timestamptz, now())) RETURNING id`,
    [
      org.id,
      to.userId,
      threadId,
      options.actor ?? null,
      options.read ? new Date() : null,
      options.at ?? null,
    ],
  );
}

/* --------------------------------------------------------------------------
   行を作る
   -------------------------------------------------------------------------- */

describe('コメントから積まれる行', () => {
  it('ウォッチしている人に届く', async () => {
    const { admin, other, thread } = await stage();
    await setWatch(other, thread.id, true);

    const posted = await postComment(admin, thread.id, 'できました');
    assert.equal(posted.ok, true);

    assert.deepEqual(await rowsFor(thread.id), [{ user_id: other.userId, kind: 'comment' }]);
  });

  it('ウォッチは自動では付かない', async () => {
    const { admin, other, thread } = await stage();

    // 立てた人も、書いた人も、ウォッチしたことにはならない
    await postComment(other, thread.id, 'まだ調べています');
    assert.deepEqual(await rowsFor(thread.id), []);
    assert.equal(await isWatching(admin, thread.id), false);
    assert.equal(await isWatching(other, thread.id), false);
  });

  it('自分の投稿では自分に届かない', async () => {
    const { admin, thread } = await stage();
    await setWatch(admin, thread.id, true);

    await postComment(admin, thread.id, '独り言');
    assert.deepEqual(await rowsFor(thread.id), []);
  });

  it('指名された人には、ウォッチの行を重ねない', async () => {
    const { admin, other, thread } = await stage();
    await setWatch(other, thread.id, true);

    await postComment(admin, thread.id, '@田中 亮 見てください');

    // 同じコメントで二度知らせない。二度目に新しい情報がない
    assert.deepEqual(await rowsFor(thread.id), [{ user_id: other.userId, kind: 'mention' }]);
  });

  it('非公開に変わったあとのウォッチには届かない', async () => {
    const { org, admin, other, thread, project } = await stage();
    await setWatch(other, thread.id, true);

    // 公開のうちに付けたウォッチが、非公開に変えたあとも残っている
    await pool.query(`UPDATE projects SET visibility = 'private' WHERE id = $1`, [project.id]);
    await postComment(admin, thread.id, 'この件は社外秘です');

    assert.deepEqual(await rowsFor(thread.id), []);
    assert.equal(
      await value<string>(`SELECT count(*) FROM watches WHERE thread_id = $1`, [thread.id]),
      '1',
      'ウォッチの行そのものは残る',
    );
    assert.equal(org.id, admin.organizationId);
  });

  it('プロジェクトから外された人のウォッチにも届かない', async () => {
    const { admin, other, thread, project } = await stage({ visibility: 'private' });
    await setWatch(other, thread.id, true);

    await pool.query(
      `UPDATE project_members SET deleted_at = now() WHERE project_id = $1 AND user_id = $2`,
      [project.id, other.userId],
    );
    await postComment(admin, thread.id, '続きです');

    assert.deepEqual(await rowsFor(thread.id), []);
  });

  it('組織から外れた人のウォッチにも届かない', async () => {
    const { admin, other, thread, org } = await stage();
    await setWatch(other, thread.id, true);

    await pool.query(
      `UPDATE organization_members SET deleted_at = now()
        WHERE organization_id = $1 AND user_id = $2`,
      [org.id, other.userId],
    );
    await postComment(admin, thread.id, '続きです');

    assert.deepEqual(await rowsFor(thread.id), []);
  });
});

describe('担当者から積まれる行', () => {
  it('設定した相手に届く', async () => {
    const { admin, other, thread } = await stage();

    const done = await setAssignee(admin, thread.id, other.userId);
    assert.equal(done.ok, true);
    assert.deepEqual(await rowsFor(thread.id), [{ user_id: other.userId, kind: 'assigned' }]);
  });

  it('同じ人を選び直しても増えない', async () => {
    const { admin, other, thread } = await stage();

    await setAssignee(admin, thread.id, other.userId);
    await setAssignee(admin, thread.id, other.userId);

    assert.equal((await rowsFor(thread.id)).length, 1);
  });

  it('外したときは誰にも届かない', async () => {
    const { admin, other, thread } = await stage();

    await setAssignee(admin, thread.id, other.userId);
    await setAssignee(admin, thread.id, null);

    assert.equal((await rowsFor(thread.id)).length, 1);
  });

  it('自分を担当者にしても届かない', async () => {
    const { admin, thread } = await stage();

    await setAssignee(admin, thread.id, admin.userId);
    assert.deepEqual(await rowsFor(thread.id), []);
  });

  it('立てるときに指名しても届く', async () => {
    const { admin, other, project } = await stage();

    const made = await createThread(admin, project.id, {
      type: 'kadai',
      title: '検索APIの実装',
      body: '',
      parentNumber: null,
      assigneeUserId: other.userId,
      startsOn: null,
      endsOn: null,
    });
    assert.equal(made.ok, true);

    const { rows } = await pool.query<{ kind: string; user_id: string }>(
      `SELECT kind, user_id FROM notifications WHERE organization_id = $1`,
      [admin.organizationId],
    );
    assert.deepEqual(rows, [{ kind: 'assigned', user_id: other.userId }]);
  });

  it('見えなくなった人は担当者に設定しても届かない', async () => {
    const { admin, other, thread, project } = await stage({ visibility: 'private' });

    await pool.query(
      `UPDATE project_members SET deleted_at = now() WHERE project_id = $1 AND user_id = $2`,
      [project.id, other.userId],
    );
    // 組織のメンバーではあるので、担当者そのものには設定できる
    const done = await setAssignee(admin, thread.id, other.userId);
    assert.equal(done.ok, true);
    assert.deepEqual(await rowsFor(thread.id), []);
  });
});

/* --------------------------------------------------------------------------
   読む
   -------------------------------------------------------------------------- */

describe('通知の一覧', () => {
  it('未読は全部出る', async () => {
    const { org, admin, other, thread } = await stage();
    for (let i = 0; i < READ_LIMIT + 5; i++) {
      await plant(org, other, thread.id, { actor: admin.userId });
    }

    const list = await listNotifications(other);
    assert.equal(list.length, READ_LIMIT + 5);
    assert.equal(await countUnread(other), READ_LIMIT + 5);
  });

  it('既読は直近だけ出る', async () => {
    const { org, admin, other, thread } = await stage();
    for (let i = 0; i < READ_LIMIT + 5; i++) {
      await plant(org, other, thread.id, { actor: admin.userId, read: true });
    }

    const list = await listNotifications(other);
    assert.equal(list.length, READ_LIMIT);
    assert.equal(await countUnread(other), 0);
  });

  it('未読と既読を混ぜて、新しい順に並べる', async () => {
    const { org, admin, other, thread } = await stage();
    await plant(org, other, thread.id, { actor: admin.userId, read: true, at: '2026-09-03' });
    await plant(org, other, thread.id, { actor: admin.userId, at: '2026-09-01' });
    await plant(org, other, thread.id, { actor: admin.userId, read: true, at: '2026-09-05' });

    // 新しい順に 9/5（既読）、9/3（既読）、9/1（未読）。未読を上へ持ち上げない
    const list = await listNotifications(other);
    assert.deepEqual(
      list.map((row) => row.read),
      [true, true, false],
    );
  });

  it('誰が何をしたかが読める', async () => {
    const { admin, other, thread, project } = await stage();
    await setAssignee(admin, thread.id, other.userId);

    const [row] = await listNotifications(other);
    assert.equal(row?.kind, 'assigned');
    assert.equal(row?.actorName, '佐藤 明日香');
    assert.equal(row?.projectKey, project.key);
    assert.equal(row?.number, thread.number);
    assert.equal(row?.title, '検索の設計');
    assert.equal(row?.commentId, null);
  });

  it('見えなくなったプロジェクトの通知は出ない', async () => {
    const { org, admin, other, thread, project } = await stage();
    await plant(org, other, thread.id, { actor: admin.userId });

    await pool.query(`UPDATE projects SET visibility = 'private' WHERE id = $1`, [project.id]);

    assert.deepEqual(await listNotifications(other), []);
    assert.equal(await countUnread(other), 0);
  });

  it('組織管理者を騙っても、行は出てこない', async () => {
    const { org, admin, other, thread, project } = await stage();
    await plant(org, other, thread.id, { actor: admin.userId });
    await pool.query(`UPDATE projects SET visibility = 'private' WHERE id = $1`, [project.id]);

    // isOrgAdmin は画面の出し分けのための値である。SQL は信用しない
    assert.deepEqual(await listNotifications(faked(other)), []);
  });

  it('消されたスレッドの通知は出ない', async () => {
    const { org, admin, other, thread } = await stage();
    await plant(org, other, thread.id, { actor: admin.userId });

    // 畳まずには消せない。先に畳んでから消す
    await pool.query(
      `UPDATE threads SET archived_at = now(), deleted_at = now() WHERE id = $1`,
      [thread.id],
    );
    assert.deepEqual(await listNotifications(other), []);
  });

  it('畳まれたスレッドの通知は出る', async () => {
    const { org, admin, other, thread } = await stage();
    await plant(org, other, thread.id, { actor: admin.userId });

    await setThreadArchived(admin, thread.id, true);
    assert.equal((await listNotifications(other)).length, 1);
  });

  it('コメントが消されても、指名された事実は残る', async () => {
    const { admin, other, thread } = await stage();
    await postComment(admin, thread.id, '@田中 亮 お願いします');

    const commentId = await value<string>(`SELECT id FROM comments WHERE thread_id = $1`, [
      thread.id,
    ]);
    await pool.query(`UPDATE comments SET deleted_at = now() WHERE id = $1`, [commentId]);

    const [row] = await listNotifications(other);
    assert.equal(row?.kind, 'mention');
    assert.equal(row?.commentId, commentId);
    assert.equal(row?.commentDeleted, true);
  });
});

/* --------------------------------------------------------------------------
   既読
   -------------------------------------------------------------------------- */

describe('既読', () => {
  it('開くと既読になり、行き先が返る', async () => {
    const { admin, other, thread, project } = await stage();
    await postComment(admin, thread.id, '@田中 亮 お願いします');
    const [before] = await listNotifications(other);

    const to = await openNotification(other, before?.id ?? '');
    assert.equal(to?.projectKey, project.key);
    assert.equal(to?.number, thread.number);
    assert.notEqual(to?.commentId, null);
    assert.equal(await countUnread(other), 0);
  });

  it('二度開いても、最初に読んだ時刻のまま', async () => {
    const { org, admin, other, thread } = await stage();
    const id = await plant(org, other, thread.id, { actor: admin.userId });

    await openNotification(other, id);
    const first = await value<Date>(`SELECT read_at FROM notifications WHERE id = $1`, [id]);
    await openNotification(other, id);
    const second = await value<Date>(`SELECT read_at FROM notifications WHERE id = $1`, [id]);

    assert.deepEqual(first, second);
  });

  it('他人あての通知は開けない', async () => {
    const { org, admin, other, thread } = await stage();
    const id = await plant(org, other, thread.id, { actor: admin.userId });

    assert.equal(await openNotification(admin, id), null);
    assert.equal(await countUnread(other), 1, '他人が開いても未読のまま');
  });

  it('まとめて既読にできる', async () => {
    const { org, admin, other, thread } = await stage();
    await plant(org, other, thread.id, { actor: admin.userId });
    await plant(org, other, thread.id, { actor: admin.userId });

    assert.equal(await markAllRead(other), 2);
    assert.equal(await countUnread(other), 0);
  });

  it('まとめて既読にしても、見えない行には触らない', async () => {
    const { org, admin, other, thread, project } = await stage();
    const hidden = await plant(org, other, thread.id, { actor: admin.userId });
    await pool.query(`UPDATE projects SET visibility = 'private' WHERE id = $1`, [project.id]);

    assert.equal(await markAllRead(other), 0);
    assert.equal(
      await value(`SELECT read_at FROM notifications WHERE id = $1`, [hidden]),
      null,
    );
  });

  it('他人の未読は畳まれない', async () => {
    const { org, admin, other, thread } = await stage();
    await plant(org, admin, thread.id, { actor: other.userId });
    await plant(org, other, thread.id, { actor: admin.userId });

    await markAllRead(other);
    assert.equal(await countUnread(admin), 1);
  });
});

/* --------------------------------------------------------------------------
   ウォッチ
   -------------------------------------------------------------------------- */

describe('ウォッチ', () => {
  it('付けて外せる', async () => {
    const { other, thread } = await stage();

    assert.equal(await isWatching(other, thread.id), false);
    assert.deepEqual(await setWatch(other, thread.id, true), { ok: true });
    assert.equal(await isWatching(other, thread.id), true);
    assert.deepEqual(await setWatch(other, thread.id, false), { ok: true });
    assert.equal(await isWatching(other, thread.id), false);
  });

  it('二度押しても行は増えない', async () => {
    const { other, thread } = await stage();

    await setWatch(other, thread.id, true);
    assert.deepEqual(await setWatch(other, thread.id, true), { ok: true });
    assert.equal(
      await value<string>(`SELECT count(*) FROM watches WHERE thread_id = $1`, [thread.id]),
      '1',
    );
  });

  it('見えないスレッドには付けられない', async () => {
    const { other, thread, project } = await stage({ visibility: 'private' });
    await pool.query(
      `UPDATE project_members SET deleted_at = now() WHERE project_id = $1 AND user_id = $2`,
      [project.id, other.userId],
    );

    assert.deepEqual(await setWatch(other, thread.id, true), {
      ok: false,
      reason: 'not-found',
    });
    assert.deepEqual(await setWatch(faked(other), thread.id, true), {
      ok: false,
      reason: 'not-found',
    });
  });

  it('畳んだスレッドでも付け外しできる', async () => {
    const { admin, other, thread } = await stage();
    await setThreadArchived(admin, thread.id, true);

    // 自分あての設定であって、書き込みではない。
    // 外す手立てまで消えると、戻したときに困る
    assert.deepEqual(await setWatch(other, thread.id, true), { ok: true });
    assert.equal(await isWatching(other, thread.id), true);
    assert.deepEqual(await setWatch(other, thread.id, false), { ok: true });
  });
});
