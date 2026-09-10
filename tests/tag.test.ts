import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import type { MemberRole } from '#features/organization/queries.ts';
import { DEFAULT_TAG_COLOR, TAG_COLORS } from '#features/tag/colors.ts';
import {
  attachTagByName,
  countTagUsage,
  createTag,
  deleteTag,
  detachTag,
  listProjectTags,
  listTags,
  listTagsForAdmin,
  listThreadTags,
  setThreadTags,
  updateTag,
} from '#features/tag/queries.ts';
import { createThread, listThreads } from '#features/thread/queries.ts';
import { type OrgScope, pool } from '#lib/db.ts';

/*
 * タグは組織の単位で定義し、プロジェクトをまたいで使う。
 *
 * 確かめたいのは三つある。
 * 組織の境界を越えないこと、見えないプロジェクトのスレッドを
 * 付け外しの経路から触れないこと、そして
 * 「消したら結びも消える」という取り消しの効かない決まりが
 * 本当にそのとおり動くことである。
 */

const TAG = `tag-${process.pid}`;
let seq = 0;
const uniq = (): string => {
  seq += 1;
  return `${TAG}-${seq}`;
};

let keySeq = 0;
const newKey = (): string => {
  keySeq += 1;
  return `G${keySeq}`;
};

after(async () => {
  const like = `${TAG}-%`;
  const inOrg = `organization_id IN (SELECT id FROM organizations WHERE slug LIKE $1)`;
  await pool.query(
    `DELETE FROM thread_tags WHERE thread_id IN (
       SELECT id FROM threads WHERE ${inOrg})`,
    [like],
  );
  await pool.query(`DELETE FROM notifications WHERE ${inOrg}`, [like]);
  await pool.query(`DELETE FROM threads WHERE ${inOrg}`, [like]);
  await pool.query(`DELETE FROM tags WHERE ${inOrg}`, [like]);
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

async function member(org: Org, role: MemberRole = 'admin'): Promise<OrgScope> {
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

async function newProject(
  org: Org,
  creator: string,
  visibility: 'public' | 'private' = 'public',
): Promise<{ id: string; key: string }> {
  const key = newKey();
  const id = await value(
    `INSERT INTO projects (organization_id, key, name, visibility, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [org.id, key, '検索基盤の刷新', visibility, creator],
  );
  return { id, key };
}

async function newThread(
  scope: OrgScope,
  projectId: string,
  title = '検索の要件',
): Promise<string> {
  const made = await createThread(scope, projectId, {
    type: 'kadai',
    title,
    body: '',
    parentNumber: null,
    assigneeUserId: null,
    startsOn: null,
    endsOn: null,
    tagIds: [],
  });
  assert.equal(made.ok, true);
  if (!made.ok) {
    throw new Error('立てられませんでした');
  }
  const id = await value('SELECT id FROM threads WHERE organization_id = $1 AND number = $2', [
    scope.organizationId,
    made.number,
  ]);
  return id;
}

/** 名前でタグを作り、その id を返す。 */
async function tag(
  scope: OrgScope,
  name: string,
  color: string = DEFAULT_TAG_COLOR,
): Promise<string> {
  const made = await createTag(scope, name, color);
  assert.equal(made.ok, true);
  const all = await listTags(scope);
  const found = all.find((row) => row.name === name);
  if (!found) {
    throw new Error(`作ったはずのタグが見つかりません: ${name}`);
  }
  return found.id;
}

/* --------------------------------------------------------------------------
   作る、直す
   -------------------------------------------------------------------------- */

describe('タグを作る', () => {
  it('組織のメンバーなら誰でも作れる', async () => {
    const org = await newOrg();
    const plain = await member(org, 'member');

    const made = await createTag(plain, 'backend', '#c8402c');
    assert.equal(made.ok, true);

    const all = await listTags(plain);
    assert.deepEqual(
      all.map((row) => [row.name, row.color]),
      [['backend', '#c8402c']],
    );
  });

  it('前後の空白は落とす', async () => {
    const org = await newOrg();
    const scope = await member(org);
    await createTag(scope, '  要相談  ', DEFAULT_TAG_COLOR);

    const all = await listTags(scope);
    assert.deepEqual(
      all.map((row) => row.name),
      ['要相談'],
    );
  });

  it('空の名前と、41文字は断る', async () => {
    const org = await newOrg();
    const scope = await member(org);

    assert.deepEqual(await createTag(scope, '   ', DEFAULT_TAG_COLOR), {
      ok: false,
      reason: 'invalid-name',
    });
    assert.deepEqual(await createTag(scope, 'あ'.repeat(41), DEFAULT_TAG_COLOR), {
      ok: false,
      reason: 'invalid-name',
    });
    assert.equal((await createTag(scope, 'あ'.repeat(40), DEFAULT_TAG_COLOR)).ok, true);
  });

  it('色見本に無い色は保存しない', async () => {
    const org = await newOrg();
    const scope = await member(org);

    // 制約は #rrggbb なら通す。背景に沈む色をここで止める。
    assert.deepEqual(await createTag(scope, 'bug', '#fefefe'), {
      ok: false,
      reason: 'invalid-color',
    });
    for (const color of TAG_COLORS) {
      assert.equal((await createTag(scope, `c${color}`, color)).ok, true);
    }
  });

  it('大文字小文字だけが違う名前は作れない', async () => {
    const org = await newOrg();
    const scope = await member(org);
    await createTag(scope, 'Backend', DEFAULT_TAG_COLOR);

    assert.deepEqual(await createTag(scope, 'backend', DEFAULT_TAG_COLOR), {
      ok: false,
      reason: 'duplicate-name',
    });
  });

  it('組織が違えば同じ名前を持てる', async () => {
    const one = await member(await newOrg());
    const other = await member(await newOrg());

    assert.equal((await createTag(one, 'backend', DEFAULT_TAG_COLOR)).ok, true);
    assert.equal((await createTag(other, 'backend', DEFAULT_TAG_COLOR)).ok, true);

    assert.equal((await listTags(one)).length, 1);
    assert.equal((await listTags(other)).length, 1);
  });

  it('消したあと、同じ名前をもう一度作れる', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const first = await tag(scope, 'backend');
    await deleteTag(scope, first);

    const second = await tag(scope, 'backend', '#3f6b52');

    // 起こすのではなく、別の行として入る。
    assert.notEqual(first, second);
    const all = await listTags(scope);
    assert.deepEqual(
      all.map((row) => [row.name, row.color]),
      [['backend', '#3f6b52']],
    );
  });
});

describe('タグを直す', () => {
  it('名前と色を変えられる', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const id = await tag(scope, 'bakcend');

    assert.deepEqual(await updateTag(scope, id, 'backend', '#2c4a75'), { ok: true });
    assert.deepEqual(
      (await listTags(scope)).map((row) => [row.name, row.color]),
      [['backend', '#2c4a75']],
    );
  });

  it('付いているスレッドは、名前を変えても付いたまま', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const project = await newProject(org, scope.userId);
    const thread = await newThread(scope, project.id);
    const id = await tag(scope, 'bakcend');
    await setThreadTags(scope, thread, [id]);

    await updateTag(scope, id, 'backend', DEFAULT_TAG_COLOR);

    assert.deepEqual(
      (await listThreadTags(scope, thread)).map((row) => row.name),
      ['backend'],
    );
  });

  it('他の生きたタグと同じ名前にはできない', async () => {
    const org = await newOrg();
    const scope = await member(org);
    await tag(scope, 'backend');
    const other = await tag(scope, 'frontend');

    assert.deepEqual(await updateTag(scope, other, 'backend', DEFAULT_TAG_COLOR), {
      ok: false,
      reason: 'duplicate-name',
    });
  });

  it('消えたタグの名前は、リネームで使える', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const dead = await tag(scope, 'backend');
    await deleteTag(scope, dead);
    const other = await tag(scope, 'frontend');

    // 一意索引は生きている行しか見ない。ここで起こしにはいかない。
    assert.deepEqual(await updateTag(scope, other, 'backend', DEFAULT_TAG_COLOR), { ok: true });
    assert.deepEqual(
      (await listTags(scope)).map((row) => row.name),
      ['backend'],
    );
  });

  it('他の組織のタグには触れない', async () => {
    const mine = await member(await newOrg());
    const theirs = await member(await newOrg());
    const id = await tag(theirs, 'backend');

    assert.deepEqual(await updateTag(mine, id, 'のっとり', DEFAULT_TAG_COLOR), {
      ok: false,
      reason: 'not-found',
    });
    assert.deepEqual(await deleteTag(mine, id), { ok: false, reason: 'not-found' });
    assert.deepEqual(
      (await listTags(theirs)).map((row) => row.name),
      ['backend'],
    );
  });
});

/* --------------------------------------------------------------------------
   消す
   -------------------------------------------------------------------------- */

describe('タグを消す', () => {
  it('付いていたスレッドとの結びも消える', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const project = await newProject(org, scope.userId);
    const thread = await newThread(scope, project.id);
    const id = await tag(scope, 'backend');
    await setThreadTags(scope, thread, [id]);
    assert.equal(await countTagUsage(scope, id), 1);

    assert.deepEqual(await deleteTag(scope, id), { ok: true });

    const left = await pool.query('SELECT 1 FROM thread_tags WHERE tag_id = $1', [id]);
    assert.equal(left.rowCount, 0);
    assert.deepEqual(await listThreadTags(scope, thread), []);
  });

  it('二度消せない', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const id = await tag(scope, 'backend');

    assert.deepEqual(await deleteTag(scope, id), { ok: true });
    assert.deepEqual(await deleteTag(scope, id), { ok: false, reason: 'not-found' });
  });

  it('使用数は組織のすべてのスレッドを数える', async () => {
    const org = await newOrg();
    const admin = await member(org);
    const plain = await member(org, 'member');
    const open = await newProject(org, admin.userId);
    const secret = await newProject(org, admin.userId, 'private');
    const id = await tag(admin, 'backend');

    await setThreadTags(admin, await newThread(admin, open.id), [id]);
    await setThreadTags(admin, await newThread(admin, secret.id, '見えない話'), [id]);

    /*
     * 非公開プロジェクトのスレッドは plain には見えないが、
     * それでも 2 と数える。ここの数字は「消したら何件から外れるか」の
     * 歯止めなので、見える範囲に絞ると実際より少ない数を見せてしまう。
     */
    assert.equal(await countTagUsage(plain, id), 2);
    const admins = await listTagsForAdmin(plain);
    assert.deepEqual(
      admins.map((row) => [row.name, row.usage]),
      [['backend', 2]],
    );
  });

  it('消したスレッドは使用数に入らない', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const project = await newProject(org, scope.userId);
    const thread = await newThread(scope, project.id);
    const id = await tag(scope, 'backend');
    await setThreadTags(scope, thread, [id]);

    // 削除はアーカイブを経る（threads_delete_after_archive）
    await pool.query(
      'UPDATE threads SET archived_at = now(), deleted_at = now() WHERE id = $1',
      [thread],
    );

    assert.equal(await countTagUsage(scope, id), 0);
  });
});

/* --------------------------------------------------------------------------
   スレッドへの付け外し
   -------------------------------------------------------------------------- */

describe('スレッドに付ける', () => {
  it('名前で付けられる。大文字小文字は問わない', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const project = await newProject(org, scope.userId);
    const thread = await newThread(scope, project.id);
    await tag(scope, 'Backend');

    assert.deepEqual(await attachTagByName(scope, thread, 'backend'), { ok: true });
    assert.deepEqual(
      (await listThreadTags(scope, thread)).map((row) => row.name),
      ['Backend'],
    );
  });

  it('一覧に無い名前は断る。その場で作らない', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const project = await newProject(org, scope.userId);
    const thread = await newThread(scope, project.id);
    await tag(scope, 'backend');

    assert.deepEqual(await attachTagByName(scope, thread, 'bakcend'), {
      ok: false,
      reason: 'no-such-tag',
    });
    assert.deepEqual(
      (await listTags(scope)).map((row) => row.name),
      ['backend'],
    );
  });

  it('消したタグの名前でも付かない', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const project = await newProject(org, scope.userId);
    const thread = await newThread(scope, project.id);
    const id = await tag(scope, 'backend');
    await deleteTag(scope, id);

    assert.deepEqual(await attachTagByName(scope, thread, 'backend'), {
      ok: false,
      reason: 'no-such-tag',
    });
  });

  it('消したタグの id を差し込んでも、行は増えない', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const project = await newProject(org, scope.userId);
    const thread = await newThread(scope, project.id);
    const id = await tag(scope, 'backend');
    await deleteTag(scope, id);

    assert.deepEqual(await setThreadTags(scope, thread, [id]), { ok: true });

    /*
     * listThreadTags は消したタグを結合の側で落とすので、
     * ここは thread_tags を直に見る。見えないだけで行が積まれていると、
     * 使用数と実際に消える行数がずれる。
     */
    const left = await pool.query('SELECT 1 FROM thread_tags WHERE thread_id = $1', [thread]);
    assert.equal(left.rowCount, 0);
  });

  it('二度付けても増えない', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const project = await newProject(org, scope.userId);
    const thread = await newThread(scope, project.id);
    await tag(scope, 'backend');

    await attachTagByName(scope, thread, 'backend');
    assert.deepEqual(await attachTagByName(scope, thread, 'backend'), { ok: true });
    assert.equal((await listThreadTags(scope, thread)).length, 1);
  });

  it('外せる。付いていなくても成功として返す', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const project = await newProject(org, scope.userId);
    const thread = await newThread(scope, project.id);
    const id = await tag(scope, 'backend');

    await setThreadTags(scope, thread, [id]);
    assert.deepEqual(await detachTag(scope, thread, id), { ok: true });
    assert.deepEqual(await detachTag(scope, thread, id), { ok: true });
    assert.deepEqual(await listThreadTags(scope, thread), []);
  });

  it('チェックの一覧は、送られてこなかったものを外す', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const project = await newProject(org, scope.userId);
    const thread = await newThread(scope, project.id);
    const a = await tag(scope, 'backend');
    const b = await tag(scope, 'frontend');
    const c = await tag(scope, '要相談');

    await setThreadTags(scope, thread, [a, b]);
    await setThreadTags(scope, thread, [b, c]);

    assert.deepEqual(
      (await listThreadTags(scope, thread)).map((row) => row.name),
      ['frontend', '要相談'],
    );
  });

  it('空の集合で、全部外れる', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const project = await newProject(org, scope.userId);
    const thread = await newThread(scope, project.id);
    await setThreadTags(scope, thread, [await tag(scope, 'backend')]);

    assert.deepEqual(await setThreadTags(scope, thread, []), { ok: true });
    assert.deepEqual(await listThreadTags(scope, thread), []);
  });

  it('立てるときに付けられる', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const project = await newProject(org, scope.userId);
    const id = await tag(scope, 'backend');

    const made = await createThread(scope, project.id, {
      type: 'kadai',
      title: '検索の要件',
      body: '',
      parentNumber: null,
      assigneeUserId: null,
      startsOn: null,
      endsOn: null,
      tagIds: [id],
    });
    assert.equal(made.ok, true);

    const rows = await listThreads(scope, project.id);
    assert.deepEqual(
      rows[0]?.tags.map((row) => row.name),
      ['backend'],
    );
  });

  it('他の組織のタグ id は、差し込んでも付かない', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const project = await newProject(org, scope.userId);
    const thread = await newThread(scope, project.id);
    const theirs = await tag(await member(await newOrg()), 'backend');

    assert.deepEqual(await setThreadTags(scope, thread, [theirs]), { ok: true });
    assert.deepEqual(await listThreadTags(scope, thread), []);
  });

  it('見えないプロジェクトのスレッドには付けられない', async () => {
    const org = await newOrg();
    const admin = await member(org);
    const plain = await member(org, 'member');
    const secret = await newProject(org, admin.userId, 'private');
    const thread = await newThread(admin, secret.id);
    const id = await tag(admin, 'backend');

    assert.deepEqual(await setThreadTags(plain, thread, [id]), {
      ok: false,
      reason: 'thread-not-found',
    });
    assert.deepEqual(await attachTagByName(plain, thread, 'backend'), {
      ok: false,
      reason: 'thread-not-found',
    });
    // スコープを偽っても SQL の側が信用しない
    assert.deepEqual(await listThreadTags({ ...plain, isOrgAdmin: true }, thread), []);
  });

  it('アーカイブ済みのスレッドには付け外しできない', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const project = await newProject(org, scope.userId);
    const thread = await newThread(scope, project.id);
    const id = await tag(scope, 'backend');
    await setThreadTags(scope, thread, [id]);
    await pool.query('UPDATE threads SET archived_at = now() WHERE id = $1', [thread]);

    assert.deepEqual(await setThreadTags(scope, thread, []), {
      ok: false,
      reason: 'thread-not-found',
    });
    assert.deepEqual(await detachTag(scope, thread, id), {
      ok: false,
      reason: 'thread-not-found',
    });
    // 読むほうは畳んだあとも通る。付いているものは見える。
    assert.deepEqual(
      (await listThreadTags(scope, thread)).map((row) => row.name),
      ['backend'],
    );
  });
});

/* --------------------------------------------------------------------------
   絞り込み
   -------------------------------------------------------------------------- */

describe('絞り込みの選択肢', () => {
  it('そのプロジェクトで使われているタグだけを返す', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const here = await newProject(org, scope.userId);
    const there = await newProject(org, scope.userId);
    const used = await tag(scope, 'backend');
    const elsewhere = await tag(scope, 'frontend');
    await tag(scope, '誰も使っていない');

    await setThreadTags(scope, await newThread(scope, here.id), [used]);
    await setThreadTags(scope, await newThread(scope, there.id), [elsewhere]);

    assert.deepEqual(
      (await listProjectTags(scope, here.id)).map((row) => row.name),
      ['backend'],
    );
    // 付ける側は全部出す。使われているものだけにすると、
    // 新しいタグを最初に付ける道が無くなる。
    assert.equal((await listTags(scope)).length, 3);
  });

  it('消したタグは選択肢から落ちる', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const project = await newProject(org, scope.userId);
    const id = await tag(scope, 'backend');
    await setThreadTags(scope, await newThread(scope, project.id), [id]);

    await deleteTag(scope, id);

    assert.deepEqual(await listProjectTags(scope, project.id), []);
    assert.deepEqual(await listTags(scope), []);
  });

  it('見えないプロジェクトの選択肢は引けない', async () => {
    const org = await newOrg();
    const admin = await member(org);
    const plain = await member(org, 'member');
    const secret = await newProject(org, admin.userId, 'private');
    const id = await tag(admin, 'backend');
    await setThreadTags(admin, await newThread(admin, secret.id), [id]);

    assert.deepEqual(await listProjectTags(plain, secret.id), []);
  });

  it('タグで絞ると、付いているスレッドだけが残る', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const project = await newProject(org, scope.userId);
    const id = await tag(scope, 'backend');
    const tagged = await newThread(scope, project.id, 'タグ付き');
    await newThread(scope, project.id, 'タグなし');
    await setThreadTags(scope, tagged, [id]);

    const rows = await listThreads(scope, project.id, { tagId: id });
    assert.deepEqual(
      rows.map((row) => row.title),
      ['タグ付き'],
    );
  });
});
