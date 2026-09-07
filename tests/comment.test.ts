import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import {
  deleteComment,
  listComments,
  listMentionCandidates,
  postComment,
  setCommentCheck,
} from '#features/comment/queries.ts';
import type { MemberRole } from '#features/organization/queries.ts';
import { setBodyCheck, setThreadArchived } from '#features/thread/queries.ts';
import { type OrgScope, pool, VISIBLE_PROJECT_IDS } from '#lib/db.ts';

/*
 * コメント。
 *
 * 確かめるのは四つある。
 *
 * 一つめは、見えていない人が書けないこと。
 * 二つめは、指名の候補がそのプロジェクトを閲覧できる人に限られること。
 * ここが広がると、非公開プロジェクトのスレッドの題名を含む通知が、
 * そのプロジェクトを開けない人に届く。
 * 三つめは、チェックボックスを押しても本文が変わらないこと。
 * コメントが不変であるという約束は、ここでしか守られない。
 * 四つめは、本文のチェックボックスが「編集済み」の印を付けないこと。
 */

const TAG = `cmnt-${process.pid}`;
let seq = 0;
const uniq = (): string => {
  seq += 1;
  return `${TAG}-${seq}`;
};

let keySeq = 0;
const newKey = (): string => {
  keySeq += 1;
  return `C${keySeq}`;
};

after(async () => {
  const like = `${TAG}-%`;
  const orgs = `SELECT id FROM organizations WHERE slug LIKE $1`;
  const threads = `SELECT id FROM threads WHERE organization_id IN (${orgs})`;
  const comments = `SELECT id FROM comments WHERE organization_id IN (${orgs})`;

  await pool.query(`DELETE FROM notifications WHERE organization_id IN (${orgs})`, [like]);
  await pool.query(`DELETE FROM comment_checks WHERE comment_id IN (${comments})`, [like]);
  await pool.query(`DELETE FROM comment_mentions WHERE comment_id IN (${comments})`, [like]);
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
  body = '',
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
     VALUES ($1,$2,$3,'kadai','検索の設計',$4,$5) RETURNING id`,
    [org.id, projectId, number, body, creator],
  );
  return { id, number };
}

/** ひととおり揃った場を作る。公開プロジェクトに、スレッドが一本。 */
async function stage(options: { visibility?: 'public' | 'private' } = {}) {
  const org = await newOrg();
  const admin = await member(org, 'admin', '佐藤 明日香');
  const writer = await member(org, 'member', '田中 亮');
  const project = await newProject(org, admin.userId, options);
  if (options.visibility === 'private') {
    await pool.query('INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)', [
      project.id,
      writer.userId,
    ]);
  }
  const thread = await addThread(org, project.id, admin.userId);
  return { org, admin, writer, project, thread };
}

async function notificationsFor(threadId: string) {
  const { rows } = await pool.query<{ user_id: string; kind: string }>(
    `SELECT user_id, kind FROM notifications WHERE thread_id = $1 ORDER BY kind, user_id`,
    [threadId],
  );
  return rows;
}

async function bodyOf(threadId: string) {
  const { rows } = await pool.query<{ body: string; edited: Date | null }>(
    `SELECT body, body_edited_at AS edited FROM threads WHERE id = $1`,
    [threadId],
  );
  return rows[0];
}

/* --------------------------------------------------------------------------
   指名できる人
   -------------------------------------------------------------------------- */

describe('指名できる人', () => {
  it('公開プロジェクトでは、組織にいる人が全員出る', async () => {
    const { admin, writer, project } = await stage();
    const found = await listMentionCandidates(admin, project.id);
    const ids = found.map((c) => c.userId).sort();
    assert.deepEqual(ids, [admin.userId, writer.userId].sort());
  });

  it('非公開プロジェクトでは、入っている人と組織管理者だけが出る', async () => {
    const { org, admin, writer, project } = await stage({ visibility: 'private' });
    const outsider = await member(org, 'member', '山田 太郎');

    const found = await listMentionCandidates(admin, project.id);
    const ids = found.map((c) => c.userId);
    assert.ok(ids.includes(writer.userId), 'プロジェクトのメンバーは出る');
    assert.ok(ids.includes(admin.userId), '組織管理者は出る');
    assert.ok(!ids.includes(outsider.userId), '入っていない人は出ない');
  });

  it('閲覧できるプロジェクトの判定と食い違わない', async () => {
    // 逆向きに引いた二つが一致しなければ、どちらかが漏れている
    const { org, admin, project } = await stage({ visibility: 'private' });
    await member(org, 'member', '山田 太郎');

    const candidates = await listMentionCandidates(admin, project.id);
    const { rows } = await pool.query<{ user_id: string }>(
      `SELECT user_id FROM organization_members WHERE organization_id = $1 AND deleted_at IS NULL`,
      [org.id],
    );

    for (const row of rows) {
      const visible = await pool.query(VISIBLE_PROJECT_IDS, [org.id, row.user_id]);
      const canSee = visible.rows.some((p: { id: string }) => p.id === project.id);
      const listed = candidates.some((c) => c.userId === row.user_id);
      assert.equal(listed, canSee, `${row.user_id} の扱いが二つの判定でずれている`);
    }
  });

  it('見えていない人が引いても、候補は返らない', async () => {
    const { org, project } = await stage({ visibility: 'private' });
    const outsider = await member(org, 'member', '山田 太郎');
    assert.deepEqual(await listMentionCandidates(faked(outsider), project.id), []);
  });
});

/* --------------------------------------------------------------------------
   投稿
   -------------------------------------------------------------------------- */

describe('コメントを書く', () => {
  it('閲覧できる人は書ける', async () => {
    const { writer, thread } = await stage();
    const result = await postComment(writer, thread.id, '前方一致だけで出しませんか。');
    assert.equal(result.ok, true);
  });

  it('前後の空白は落とす', async () => {
    const { writer, admin, thread } = await stage();
    await postComment(writer, thread.id, '  賛成です  \n');
    const [comment] = await listComments(admin, thread.id);
    assert.equal(comment?.body, '賛成です');
  });

  it('空の本文は断る', async () => {
    const { writer, thread } = await stage();
    const result = await postComment(writer, thread.id, '   \n  ');
    assert.deepEqual(result, { ok: false, reason: 'invalid-body' });
  });

  it('見えていない人は書けない。組織管理者を騙っても通らない', async () => {
    const { org, thread } = await stage({ visibility: 'private' });
    const outsider = await member(org, 'member', '山田 太郎');
    const result = await postComment(faked(outsider), thread.id, '通るはずがない');
    assert.deepEqual(result, { ok: false, reason: 'not-found' });
  });

  it('アーカイブされたスレッドには書けない', async () => {
    const { admin, writer, thread } = await stage();
    await setThreadArchived(admin, thread.id, true);
    const result = await postComment(writer, thread.id, '畳んだあとに書く');
    assert.deepEqual(result, { ok: false, reason: 'archived' });
  });

  it('アーカイブされたプロジェクトの中でも書けない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    const thread = await addThread(org, project.id, admin.userId);
    await pool.query('UPDATE projects SET archived_at = now() WHERE id = $1', [project.id]);

    const result = await postComment(admin, thread.id, '畳んだプロジェクトの中');
    assert.deepEqual(result, { ok: false, reason: 'project-archived' });
  });
});

/* --------------------------------------------------------------------------
   指名と通知
   -------------------------------------------------------------------------- */

describe('指名と通知', () => {
  it('指名すると、位置と相手を記録する', async () => {
    const { admin, writer, thread } = await stage();
    await postComment(writer, thread.id, '@佐藤 明日香 お願いします');

    const [comment] = await listComments(admin, thread.id);
    assert.deepEqual(comment?.mentions, [{ start: 0, end: 7 }]);
    assert.equal(comment?.body.slice(0, 7), '@佐藤 明日香');
  });

  it('指名された人に通知が立つ', async () => {
    const { admin, writer, thread } = await stage();
    await postComment(writer, thread.id, '@佐藤 明日香 お願いします');

    const rows = await notificationsFor(thread.id);
    assert.deepEqual(rows, [{ user_id: admin.userId, kind: 'mention' }]);
  });

  it('自分を指名しても通知は立たない', async () => {
    const { writer, thread } = await stage();
    await postComment(writer, thread.id, '@田中 亮 と自分で書く');
    assert.deepEqual(await notificationsFor(thread.id), []);
  });

  it('同姓同名なら、その全員に通知が立つ', async () => {
    const { org, writer, thread } = await stage();
    const one = await member(org, 'member', '鈴木 一郎');
    const two = await member(org, 'member', '鈴木 一郎');

    await postComment(writer, thread.id, '@鈴木 一郎 どちらの方でしょうか');

    const rows = await notificationsFor(thread.id);
    assert.deepEqual(rows.map((r) => r.user_id).sort(), [one.userId, two.userId].sort());
  });

  it('閲覧できない人の名前は、指名として拾わない', async () => {
    const { org, writer, thread } = await stage({ visibility: 'private' });
    await member(org, 'member', '山田 太郎');

    await postComment(writer, thread.id, '@山田 太郎 これは届かない');

    const rows = await notificationsFor(thread.id);
    assert.deepEqual(rows, []);
  });

  it('ウォッチしている人には、コメントの通知が立つ', async () => {
    const { admin, writer, thread } = await stage();
    await pool.query('INSERT INTO watches (thread_id, user_id) VALUES ($1,$2)', [
      thread.id,
      admin.userId,
    ]);

    await postComment(writer, thread.id, '進めます');

    assert.deepEqual(await notificationsFor(thread.id), [
      { user_id: admin.userId, kind: 'comment' },
    ]);
  });

  it('指名とウォッチが重なっても、通知は一つだけ', async () => {
    const { admin, writer, thread } = await stage();
    await pool.query('INSERT INTO watches (thread_id, user_id) VALUES ($1,$2)', [
      thread.id,
      admin.userId,
    ]);

    await postComment(writer, thread.id, '@佐藤 明日香 お願いします');

    assert.deepEqual(await notificationsFor(thread.id), [
      { user_id: admin.userId, kind: 'mention' },
    ]);
  });

  it('自分がウォッチしているスレッドに自分で書いても、通知は立たない', async () => {
    const { writer, thread } = await stage();
    await pool.query('INSERT INTO watches (thread_id, user_id) VALUES ($1,$2)', [
      thread.id,
      writer.userId,
    ]);
    await postComment(writer, thread.id, '自分で書く');
    assert.deepEqual(await notificationsFor(thread.id), []);
  });

  it('コードの中に書かれた名前は指名にならない', async () => {
    const { writer, thread } = await stage();
    await postComment(writer, thread.id, '`@佐藤 明日香` と書くとどうなるか');
    assert.deepEqual(await notificationsFor(thread.id), []);
  });
});

/* --------------------------------------------------------------------------
   一覧
   -------------------------------------------------------------------------- */

describe('コメントを読む', () => {
  it('古い順に並ぶ', async () => {
    const { admin, writer, thread } = await stage();
    await postComment(admin, thread.id, 'ひとつめ');
    await postComment(writer, thread.id, 'ふたつめ');
    await postComment(admin, thread.id, 'みっつめ');

    const found = await listComments(admin, thread.id);
    assert.deepEqual(
      found.map((c) => c.body),
      ['ひとつめ', 'ふたつめ', 'みっつめ'],
    );
  });

  it('書いた人の名前が付く', async () => {
    const { admin, writer, thread } = await stage();
    await postComment(writer, thread.id, '賛成です');
    const [comment] = await listComments(admin, thread.id);
    assert.equal(comment?.authorName, '田中 亮');
    assert.equal(comment?.authorUserId, writer.userId);
  });

  it('見えていない人は読めない', async () => {
    const { org, writer, thread } = await stage({ visibility: 'private' });
    await postComment(writer, thread.id, '中の話');
    const outsider = await member(org, 'member', '山田 太郎');
    assert.deepEqual(await listComments(faked(outsider), thread.id), []);
  });

  it('消したコメントは、跡だけ残って本文は返らない', async () => {
    const { admin, writer, thread } = await stage();
    const posted = await postComment(writer, thread.id, '消される本文');
    assert.ok(posted.ok);
    await deleteComment(admin, posted.id);

    const [comment] = await listComments(admin, thread.id);
    assert.equal(comment?.deleted, true);
    assert.equal(comment?.body, '');
    assert.equal(comment?.authorName, '田中 亮');
  });

  it('組織管理者でなければ消せない', async () => {
    const { writer, thread } = await stage();
    const posted = await postComment(writer, thread.id, '自分で書いた');
    assert.ok(posted.ok);
    // 書いた本人であっても消せない
    assert.deepEqual(await deleteComment(writer, posted.id), {
      ok: false,
      reason: 'forbidden',
    });
  });
});

/* --------------------------------------------------------------------------
   コメントのチェックボックス
   -------------------------------------------------------------------------- */

const LIST = 'やること\n\n- [ ] 前方一致\n- [ ] 正規化\n';

describe('コメントのチェックボックス', () => {
  it('入れると、その番号が付く', async () => {
    const { admin, writer, thread } = await stage();
    const posted = await postComment(writer, thread.id, LIST);
    assert.ok(posted.ok);

    assert.deepEqual(await setCommentCheck(admin, posted.id, 1, true), { ok: true });
    const [comment] = await listComments(admin, thread.id);
    assert.deepEqual(comment?.checks, [1]);
  });

  it('外すと消える', async () => {
    const { admin, writer, thread } = await stage();
    const posted = await postComment(writer, thread.id, LIST);
    assert.ok(posted.ok);

    await setCommentCheck(admin, posted.id, 0, true);
    await setCommentCheck(admin, posted.id, 0, false);
    const [comment] = await listComments(admin, thread.id);
    assert.deepEqual(comment?.checks, []);
  });

  it('二度入れても壊れない', async () => {
    const { admin, writer, thread } = await stage();
    const posted = await postComment(writer, thread.id, LIST);
    assert.ok(posted.ok);

    await setCommentCheck(admin, posted.id, 0, true);
    assert.deepEqual(await setCommentCheck(admin, posted.id, 0, true), { ok: true });
  });

  it('本文は一字も変わらない', async () => {
    const { admin, writer, thread } = await stage();
    const posted = await postComment(writer, thread.id, LIST);
    assert.ok(posted.ok);

    await setCommentCheck(admin, posted.id, 0, true);
    const [comment] = await listComments(admin, thread.id);
    assert.equal(comment?.body, LIST.trim());
  });

  it('書いた本人でなくても押せる', async () => {
    const { admin, writer, thread } = await stage();
    const posted = await postComment(admin, thread.id, LIST);
    assert.ok(posted.ok);
    assert.deepEqual(await setCommentCheck(writer, posted.id, 0, true), { ok: true });
  });

  it('本文にない番号は断る', async () => {
    const { admin, writer, thread } = await stage();
    const posted = await postComment(writer, thread.id, LIST);
    assert.ok(posted.ok);
    assert.deepEqual(await setCommentCheck(admin, posted.id, 5, true), {
      ok: false,
      reason: 'no-such-check',
    });
  });

  it('見えていない人は押せない', async () => {
    const { org, writer, thread } = await stage({ visibility: 'private' });
    const posted = await postComment(writer, thread.id, LIST);
    assert.ok(posted.ok);
    const outsider = await member(org, 'member', '山田 太郎');

    assert.deepEqual(await setCommentCheck(faked(outsider), posted.id, 0, true), {
      ok: false,
      reason: 'not-found',
    });
  });

  it('アーカイブされたスレッドでは押せない', async () => {
    const { admin, writer, thread } = await stage();
    const posted = await postComment(writer, thread.id, LIST);
    assert.ok(posted.ok);
    await setThreadArchived(admin, thread.id, true);

    assert.deepEqual(await setCommentCheck(admin, posted.id, 0, true), {
      ok: false,
      reason: 'archived',
    });
  });

  it('誰が入れたかを残す', async () => {
    const { admin, writer, thread } = await stage();
    const posted = await postComment(admin, thread.id, LIST);
    assert.ok(posted.ok);
    await setCommentCheck(writer, posted.id, 0, true);

    const who = await value<string>(
      'SELECT checked_by_user_id FROM comment_checks WHERE comment_id = $1 AND position = 0',
      [posted.id],
    );
    assert.equal(who, writer.userId);
  });
});

/* --------------------------------------------------------------------------
   本文のチェックボックス
   -------------------------------------------------------------------------- */

describe('本文のチェックボックス', () => {
  it('本文そのものを書き換える', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    const thread = await addThread(org, project.id, admin.userId, '- [ ] A\n- [ ] B');

    assert.deepEqual(await setBodyCheck(admin, thread.id, 1, true), { ok: true });
    assert.equal((await bodyOf(thread.id))?.body, '- [ ] A\n- [x] B');
  });

  it('「編集済み」の印は付かない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    const thread = await addThread(org, project.id, admin.userId, '- [ ] A');

    await setBodyCheck(admin, thread.id, 0, true);
    assert.equal((await bodyOf(thread.id))?.edited, null);
  });

  it('同時に別々の箱を押しても、互いを消さない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    const thread = await addThread(org, project.id, admin.userId, '- [ ] A\n- [ ] B');

    await Promise.all([
      setBodyCheck(admin, thread.id, 0, true),
      setBodyCheck(admin, thread.id, 1, true),
    ]);
    assert.equal((await bodyOf(thread.id))?.body, '- [x] A\n- [x] B');
  });

  it('本文にない番号は断る', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    const thread = await addThread(org, project.id, admin.userId, '- [ ] A');

    assert.deepEqual(await setBodyCheck(admin, thread.id, 3, true), {
      ok: false,
      reason: 'no-such-check',
    });
  });

  it('コードブロックの中の記法は押す対象にならない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    const body = '```\n- [ ] コード\n```\n\n- [ ] ほんもの';
    const thread = await addThread(org, project.id, admin.userId, body);

    await setBodyCheck(admin, thread.id, 0, true);
    assert.equal((await bodyOf(thread.id))?.body, '```\n- [ ] コード\n```\n\n- [x] ほんもの');
  });

  it('見えていない人は押せない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId, { visibility: 'private' });
    const thread = await addThread(org, project.id, admin.userId, '- [ ] A');
    const outsider = await member(org, 'member', '山田 太郎');

    assert.deepEqual(await setBodyCheck(faked(outsider), thread.id, 0, true), {
      ok: false,
      reason: 'not-found',
    });
  });

  it('アーカイブされたスレッドでは押せない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    const thread = await addThread(org, project.id, admin.userId, '- [ ] A');
    await setThreadArchived(admin, thread.id, true);

    assert.deepEqual(await setBodyCheck(admin, thread.id, 0, true), {
      ok: false,
      reason: 'archived',
    });
  });
});
