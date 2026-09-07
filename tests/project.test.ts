import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import type { MemberRole } from '#features/organization/queries.ts';
import {
  addProjectMember,
  changeVisibility,
  createProject,
  deleteProject,
  listProjectLinks,
  listProjectMembers,
  listProjects,
  removeProjectMember,
  renameProject,
  resolveProject,
  setArchived,
} from '#features/project/queries.ts';
import { type OrgScope, pool } from '#lib/db.ts';

/*
 * プロジェクトは境界である。
 *
 * 閲覧の判定そのものは tests/permission.test.ts が固定している。
 * ここで確かめるのは、その判定を使う側が判定を飛び越えないことと、
 * 誰が何を変えられるのかである。
 *
 * 権限はすべて SQL の中で確かめている。
 * 呼ぶ側が組み立てたスコープを信用しないことを、偽のスコープで固定する。
 */

const TAG = `projt-${process.pid}`;
let seq = 0;
const uniq = (): string => {
  seq += 1;
  return `${TAG}-${seq}`;
};

/** キーは英大文字と数字しか使えないので、印を付けられない。組織ごと消す。 */
let keySeq = 0;
const newKey = (): string => {
  keySeq += 1;
  return `K${keySeq}`;
};

after(async () => {
  const like = `${TAG}-%`;
  await pool.query(
    `DELETE FROM threads WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE $1)`,
    [like],
  );
  await pool.query(
    `DELETE FROM project_members WHERE project_id IN (
       SELECT p.id FROM projects p
        JOIN organizations o ON o.id = p.organization_id
       WHERE o.slug LIKE $1)`,
    [like],
  );
  await pool.query(
    `DELETE FROM projects WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE $1)`,
    [like],
  );
  await pool.query(
    `DELETE FROM organization_members WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE $1)`,
    [like],
  );
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

/** 組織にひとり足して、その人のスコープを返す。 */
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

/** 画面を通さずにプロジェクトを置く。作成そのものを試す場所以外で使う。 */
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
  type: 'kadai' | 'giron' | 'shitsumon',
): Promise<void> {
  const number = await value<string>(
    `UPDATE organizations SET next_thread_number = next_thread_number + 1
      WHERE id = $1 RETURNING next_thread_number - 1`,
    [org.id],
  );
  await pool.query(
    `INSERT INTO threads (organization_id, project_id, number, type, title, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [org.id, projectId, Number(number), type, '検索の設計', creator],
  );
}

async function isProjectMember(projectId: string, userId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    'SELECT 1 FROM project_members WHERE project_id=$1 AND user_id=$2 AND deleted_at IS NULL',
    [projectId, userId],
  );
  return rowCount === 1;
}

/* --------------------------------------------------------------------------
   一覧
   -------------------------------------------------------------------------- */

describe('プロジェクトの一覧', () => {
  it('公開プロジェクトは組織の全員に並ぶ', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const plain = await member(org, 'member');
    const project = await newProject(org, admin.userId);

    const keys = (await listProjects(plain)).map((p) => p.key);
    assert.deepEqual(keys, [project.key]);
  });

  it('非公開プロジェクトは、メンバーでない人には並ばない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const plain = await member(org, 'member');
    await newProject(org, admin.userId, { visibility: 'private' });

    assert.deepEqual(await listProjects(plain), []);
  });

  it('非公開プロジェクトも、組織管理者には並ぶ', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const other = await member(org, 'admin');
    await newProject(org, admin.userId, { visibility: 'private' });

    assert.equal((await listProjects(other)).length, 1);
  });

  it('非公開プロジェクトは、加えられた人には並ぶ', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const plain = await member(org, 'member');
    const project = await newProject(org, admin.userId, { visibility: 'private' });
    await addProjectMember(admin, project.id, plain.userId, false);

    assert.equal((await listProjects(plain)).length, 1);
  });

  it('他の組織のプロジェクトは並ばない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    await newProject(org, admin.userId);

    const elsewhere = await newOrg();
    const stranger = await member(elsewhere, 'admin');

    assert.deepEqual(await listProjects(stranger), []);
  });

  it('アーカイブ済みも既定で並ぶ。隠すことも選べる', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    await newProject(org, admin.userId);
    await newProject(org, admin.userId, { archived: true });

    assert.equal((await listProjects(admin)).length, 2);
    assert.equal((await listProjects(admin, { includeArchived: false })).length, 1);
  });

  it('種別ごとに数える', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);
    await addThread(org, project.id, admin.userId, 'kadai');
    await addThread(org, project.id, admin.userId, 'kadai');
    await addThread(org, project.id, admin.userId, 'giron');

    const row = (await listProjects(admin))[0];
    assert.equal(row?.kadai, 2);
    assert.equal(row?.giron, 1);
    assert.equal(row?.shitsumon, 0);
  });

  it('左帯にはアーカイブ済みを出さない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const living = await newProject(org, admin.userId);
    await newProject(org, admin.userId, { archived: true });

    assert.deepEqual(
      (await listProjectLinks(admin)).map((p) => p.key),
      [living.key],
    );
  });
});

/* --------------------------------------------------------------------------
   一件
   -------------------------------------------------------------------------- */

describe('プロジェクトを引く', () => {
  it('見えないプロジェクトは null。存在しないキーと区別しない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const plain = await member(org, 'member');
    const project = await newProject(org, admin.userId, { visibility: 'private' });

    assert.equal(await resolveProject(plain, project.key), null);
    assert.equal(await resolveProject(plain, 'NOSUCH'), null);
  });

  it('小文字で来ても引ける', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);

    const found = await resolveProject(admin, project.key.toLowerCase());
    assert.equal(found?.key, project.key);
  });

  it('組織管理者は、行が無くてもメンバーを管理できる', async () => {
    const org = await newOrg();
    const creator = await member(org, 'admin');
    const other = await member(org, 'admin');
    const project = await newProject(org, creator.userId, { visibility: 'private' });

    const found = await resolveProject(other, project.key);
    assert.equal(found?.canManage, true);
    assert.equal(await isProjectMember(project.id, other.userId), false);
  });

  it('ただのメンバーは管理できない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const plain = await member(org, 'member');
    const project = await newProject(org, admin.userId, { visibility: 'private' });
    await addProjectMember(admin, project.id, plain.userId, false);

    const found = await resolveProject(plain, project.key);
    assert.equal(found?.canManage, false);
  });

  it('プロジェクト管理者は管理できる', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const lead = await member(org, 'member');
    const project = await newProject(org, admin.userId, { visibility: 'private' });
    await addProjectMember(admin, project.id, lead.userId, true);

    const found = await resolveProject(lead, project.key);
    assert.equal(found?.canManage, true);
  });

  it('組織から外れたら、プロジェクト管理者の行が残っていても管理できない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const lead = await member(org, 'member');
    const project = await newProject(org, admin.userId);
    await addProjectMember(admin, project.id, lead.userId, true);

    await pool.query(
      `UPDATE organization_members SET deleted_at = now()
        WHERE organization_id=$1 AND user_id=$2`,
      [org.id, lead.userId],
    );

    assert.equal(await resolveProject(lead, project.key), null);
  });
});

/* --------------------------------------------------------------------------
   作る
   -------------------------------------------------------------------------- */

describe('プロジェクトを作る', () => {
  const input = {
    name: '検索基盤の刷新',
    description: '検索を作り直す',
    visibility: 'public',
  } as const;

  it('組織管理者は作れる', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');

    const result = await createProject(admin, { ...input, key: newKey() });
    assert.equal(result.ok, true);
  });

  it('作った人はプロジェクト管理者になる', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');

    const result = await createProject(admin, { ...input, key: newKey() });
    assert.ok(result.ok);
    const project = await resolveProject(admin, result.key);
    assert.ok(project);
    const members = await listProjectMembers(admin, project.id);
    assert.deepEqual(
      members.map((m) => [m.userId, m.isAdmin]),
      [[admin.userId, true]],
    );
  });

  it('ただのメンバーは作れない', async () => {
    const org = await newOrg();
    const plain = await member(org, 'member');

    const result = await createProject(plain, { ...input, key: newKey() });
    assert.deepEqual(result, { ok: false, reason: 'forbidden' });
  });

  it('スコープに管理者と書いてあっても作れない', async () => {
    const org = await newOrg();
    const plain = await member(org, 'member');

    const result = await createProject(faked(plain), { ...input, key: newKey() });
    assert.deepEqual(result, { ok: false, reason: 'forbidden' });
  });

  it('組織に属していない人は作れない', async () => {
    const org = await newOrg();
    const outsider = await newUser('外の人');

    const result = await createProject(
      { organizationId: org.id, userId: outsider, isOrgAdmin: true, timezone: 'Asia/Tokyo' },
      { ...input, key: newKey() },
    );
    assert.deepEqual(result, { ok: false, reason: 'forbidden' });
  });

  it('キーは大文字に直る', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const key = newKey();

    const result = await createProject(admin, { ...input, key: key.toLowerCase() });
    assert.ok(result.ok);
    assert.equal(result.key, key);
  });

  it('使えないキーは弾く', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');

    assert.deepEqual(await createProject(admin, { ...input, key: 'A' }), {
      ok: false,
      reason: 'invalid-key',
    });
    assert.deepEqual(await createProject(admin, { ...input, key: 'WEB-1' }), {
      ok: false,
      reason: 'invalid-key',
    });
    assert.deepEqual(await createProject(admin, { ...input, key: 'ABCDEFGHIJK' }), {
      ok: false,
      reason: 'invalid-key',
    });
  });

  it('名前が空なら作れない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');

    const result = await createProject(admin, { ...input, name: '   ', key: newKey() });
    assert.deepEqual(result, { ok: false, reason: 'invalid-name' });
  });

  it('同じキーは二つ作れない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const key = newKey();

    assert.ok((await createProject(admin, { ...input, key })).ok);
    assert.deepEqual(await createProject(admin, { ...input, key }), {
      ok: false,
      reason: 'duplicate-key',
    });
  });

  it('別の組織なら同じキーを使える', async () => {
    const key = newKey();
    const first = await member(await newOrg(), 'admin');
    const second = await member(await newOrg(), 'admin');

    assert.ok((await createProject(first, { ...input, key })).ok);
    assert.ok((await createProject(second, { ...input, key })).ok);
  });
});

/* --------------------------------------------------------------------------
   設定
   -------------------------------------------------------------------------- */

describe('プロジェクトの設定', () => {
  it('組織管理者は名前と説明を変えられる', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);

    assert.deepEqual(await renameProject(admin, project.id, '請求まわり', '締めの見直し'), {
      ok: true,
    });
    const found = await resolveProject(admin, project.key);
    assert.equal(found?.name, '請求まわり');
    assert.equal(found?.description, '締めの見直し');
  });

  it('プロジェクト管理者も名前と説明を変えられる', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const lead = await member(org, 'member');
    const project = await newProject(org, admin.userId);
    await addProjectMember(admin, project.id, lead.userId, true);

    assert.deepEqual(await renameProject(lead, project.id, '請求まわり', '締めの見直し'), {
      ok: true,
    });
  });

  it('ただのプロジェクトメンバーは名前を変えられない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const plain = await member(org, 'member');
    const project = await newProject(org, admin.userId);
    await addProjectMember(admin, project.id, plain.userId, false);

    assert.deepEqual(await renameProject(faked(plain), project.id, '乗っ取り', ''), {
      ok: false,
      reason: 'forbidden',
    });
  });

  it('名前を空にはできない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);

    assert.deepEqual(await renameProject(admin, project.id, '  ', ''), {
      ok: false,
      reason: 'invalid-name',
    });
  });

  it('公開と非公開を切り替えられる', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const plain = await member(org, 'member');
    const project = await newProject(org, admin.userId);

    assert.equal((await listProjects(plain)).length, 1);
    assert.deepEqual(await changeVisibility(admin, project.id, 'private'), { ok: true });
    assert.equal((await listProjects(plain)).length, 0);
    assert.deepEqual(await changeVisibility(admin, project.id, 'public'), { ok: true });
    assert.equal((await listProjects(plain)).length, 1);
  });

  it('プロジェクト管理者も公開設定を切り替えられる', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const lead = await member(org, 'member');
    const project = await newProject(org, admin.userId, { visibility: 'private' });
    await addProjectMember(admin, project.id, lead.userId, true);

    /*
     * この人はすでに顔ぶれを決められる。
     * 組織のメンバーを一人ずつ足せば公開とほぼ同じ状態を作れるので、
     * 切り替えだけを止めても守りにならない。
     */
    assert.deepEqual(await changeVisibility(lead, project.id, 'public'), { ok: true });
  });

  it('スコープに管理者と書いてあっても切り替えられない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const plain = await member(org, 'member');
    const project = await newProject(org, admin.userId);

    assert.deepEqual(await changeVisibility(faked(plain), project.id, 'private'), {
      ok: false,
      reason: 'forbidden',
    });
  });

  it('他の組織のプロジェクトは変えられない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);

    const elsewhere = await newOrg();
    const stranger = await member(elsewhere, 'admin');

    assert.deepEqual(await renameProject(stranger, project.id, '乗っ取り', ''), {
      ok: false,
      reason: 'forbidden',
    });
  });

  it('畳んで、戻せる', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);

    assert.deepEqual(await setArchived(admin, project.id, true), { ok: true });
    assert.equal((await resolveProject(admin, project.key))?.archived, true);
    assert.deepEqual(await setArchived(admin, project.id, false), { ok: true });
    assert.equal((await resolveProject(admin, project.key))?.archived, false);
  });

  it('プロジェクト管理者も畳める', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const lead = await member(org, 'member');
    const project = await newProject(org, admin.userId);
    await addProjectMember(admin, project.id, lead.userId, true);

    assert.deepEqual(await setArchived(lead, project.id, true), { ok: true });
    assert.deepEqual(await setArchived(lead, project.id, false), { ok: true });
  });

  it('プロジェクトの外の人は畳めない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const plain = await member(org, 'member');
    const project = await newProject(org, admin.userId);

    assert.deepEqual(await setArchived(faked(plain), project.id, true), {
      ok: false,
      reason: 'forbidden',
    });
  });
});

/* --------------------------------------------------------------------------
   削除
   -------------------------------------------------------------------------- */

describe('プロジェクトの削除', () => {
  it('畳んでいなければ削除できない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId);

    assert.deepEqual(await deleteProject(admin, project.id), {
      ok: false,
      reason: 'not-archived',
    });
  });

  it('畳んであれば削除できて、一覧から消える', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId, { archived: true });

    assert.deepEqual(await deleteProject(admin, project.id), { ok: true });
    assert.deepEqual(await listProjects(admin), []);
    assert.equal(await resolveProject(admin, project.key), null);
  });

  it('ただのメンバーは削除できない。理由も明かさない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const plain = await member(org, 'member');
    const project = await newProject(org, admin.userId, { archived: true });

    assert.deepEqual(await deleteProject(faked(plain), project.id), {
      ok: false,
      reason: 'forbidden',
    });
  });

  it('プロジェクト管理者でも削除はできない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const lead = await member(org, 'member');
    const project = await newProject(org, admin.userId, { archived: true });
    await addProjectMember(admin, project.id, lead.userId, true);

    // 設定の他の項目は任せてあるが、ここだけは組織管理者に残してある。
    assert.deepEqual(await deleteProject(faked(lead), project.id), {
      ok: false,
      reason: 'forbidden',
    });
    assert.equal((await listProjects(admin)).length, 1);
  });

  it('消したあとなら、同じキーをまた使える', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId, { archived: true });
    await deleteProject(admin, project.id);

    const result = await createProject(admin, {
      key: project.key,
      name: '作り直し',
      description: '',
      visibility: 'public',
    });
    assert.equal(result.ok, true);
  });
});

/* --------------------------------------------------------------------------
   メンバー
   -------------------------------------------------------------------------- */

describe('プロジェクトのメンバー', () => {
  it('組織管理者は足せる', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const plain = await member(org, 'member');
    const project = await newProject(org, admin.userId, { visibility: 'private' });

    assert.deepEqual(await addProjectMember(admin, project.id, plain.userId, false), {
      ok: true,
    });
    assert.equal(await isProjectMember(project.id, plain.userId), true);
  });

  it('プロジェクト管理者も足せる', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const lead = await member(org, 'member');
    const plain = await member(org, 'member');
    const project = await newProject(org, admin.userId, { visibility: 'private' });
    await addProjectMember(admin, project.id, lead.userId, true);

    assert.deepEqual(await addProjectMember(lead, project.id, plain.userId, false), {
      ok: true,
    });
  });

  it('ただのメンバーは足せない。スコープを偽っても通らない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const plain = await member(org, 'member');
    const other = await member(org, 'member');
    const project = await newProject(org, admin.userId, { visibility: 'private' });
    await addProjectMember(admin, project.id, plain.userId, false);

    assert.deepEqual(await addProjectMember(faked(plain), project.id, other.userId, false), {
      ok: false,
      reason: 'forbidden',
    });
  });

  it('組織のメンバーでない人は足せない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const outsider = await newUser('外の人');
    const project = await newProject(org, admin.userId, { visibility: 'private' });

    assert.deepEqual(await addProjectMember(admin, project.id, outsider, false), {
      ok: false,
      reason: 'not-org-member',
    });
  });

  it('もう一度足すと、権限だけが変わる', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const plain = await member(org, 'member');
    const project = await newProject(org, admin.userId, { visibility: 'private' });

    await addProjectMember(admin, project.id, plain.userId, false);
    await addProjectMember(admin, project.id, plain.userId, true);

    const members = await listProjectMembers(admin, project.id);
    const target = members.filter((m) => m.userId === plain.userId);
    assert.equal(target.length, 1);
    assert.equal(target[0]?.isAdmin, true);
  });

  it('外して呼び戻しても、生きた行は一本のまま', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const plain = await member(org, 'member');
    const project = await newProject(org, admin.userId, { visibility: 'private' });

    for (let i = 0; i < 3; i += 1) {
      assert.deepEqual(await addProjectMember(admin, project.id, plain.userId, false), {
        ok: true,
      });
      assert.deepEqual(await removeProjectMember(admin, project.id, plain.userId), {
        ok: true,
      });
    }
    assert.deepEqual(await addProjectMember(admin, project.id, plain.userId, false), {
      ok: true,
    });

    const live = await pool.query(
      'SELECT 1 FROM project_members WHERE project_id=$1 AND user_id=$2 AND deleted_at IS NULL',
      [project.id, plain.userId],
    );
    assert.equal(live.rowCount, 1);
  });

  it('外すと、非公開プロジェクトが見えなくなる', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const plain = await member(org, 'member');
    const project = await newProject(org, admin.userId, { visibility: 'private' });

    await addProjectMember(admin, project.id, plain.userId, false);
    assert.equal((await listProjects(plain)).length, 1);

    assert.deepEqual(await removeProjectMember(admin, project.id, plain.userId), { ok: true });
    assert.equal((await listProjects(plain)).length, 0);
  });

  it('登録されていない人は外せない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const plain = await member(org, 'member');
    const project = await newProject(org, admin.userId, { visibility: 'private' });

    assert.deepEqual(await removeProjectMember(admin, project.id, plain.userId), {
      ok: false,
      reason: 'not-member',
    });
  });

  it('ただのメンバーは外せない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const plain = await member(org, 'member');
    const other = await member(org, 'member');
    const project = await newProject(org, admin.userId, { visibility: 'private' });
    await addProjectMember(admin, project.id, plain.userId, false);
    await addProjectMember(admin, project.id, other.userId, false);

    assert.deepEqual(await removeProjectMember(faked(plain), project.id, other.userId), {
      ok: false,
      reason: 'forbidden',
    });
    assert.equal(await isProjectMember(project.id, other.userId), true);
  });

  it('組織から外れたプロジェクト管理者は、もう誰も足せない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const lead = await member(org, 'member');
    const plain = await member(org, 'member');
    const project = await newProject(org, admin.userId, { visibility: 'private' });
    await addProjectMember(admin, project.id, lead.userId, true);

    /*
     * 組織からは外すが、project_members の行はわざと残す。
     * 外すときに両方を畳む規律に権限を預けていないことを、ここで固定する。
     */
    await pool.query(
      `UPDATE organization_members SET deleted_at = now()
        WHERE organization_id=$1 AND user_id=$2`,
      [org.id, lead.userId],
    );
    assert.equal(await isProjectMember(project.id, lead.userId), true);

    assert.deepEqual(await addProjectMember(faked(lead), project.id, plain.userId, false), {
      ok: false,
      reason: 'forbidden',
    });
    assert.equal(await isProjectMember(project.id, plain.userId), false);
  });

  it('組織から外れたプロジェクト管理者は、もう誰も外せない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const lead = await member(org, 'member');
    const plain = await member(org, 'member');
    const project = await newProject(org, admin.userId, { visibility: 'private' });
    await addProjectMember(admin, project.id, lead.userId, true);
    await addProjectMember(admin, project.id, plain.userId, false);

    await pool.query(
      `UPDATE organization_members SET deleted_at = now()
        WHERE organization_id=$1 AND user_id=$2`,
      [org.id, lead.userId],
    );

    assert.deepEqual(await removeProjectMember(faked(lead), project.id, plain.userId), {
      ok: false,
      reason: 'forbidden',
    });
    assert.equal(await isProjectMember(project.id, plain.userId), true);
  });

  it('組織から外れた人は、行が残っていても一覧に並ばない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const plain = await member(org, 'member');
    const project = await newProject(org, admin.userId, { visibility: 'private' });
    await addProjectMember(admin, project.id, plain.userId, false);

    await pool.query(
      `UPDATE organization_members SET deleted_at = now()
        WHERE organization_id=$1 AND user_id=$2`,
      [org.id, plain.userId],
    );

    const members = await listProjectMembers(admin, project.id);
    assert.equal(
      members.some((m) => m.userId === plain.userId),
      false,
    );
  });

  it('他の組織の人は、プロジェクトのメンバーを覗けない', async () => {
    const org = await newOrg();
    const admin = await member(org, 'admin');
    const project = await newProject(org, admin.userId, { visibility: 'private' });

    const elsewhere = await newOrg();
    const stranger = await member(elsewhere, 'admin');

    assert.deepEqual(await listProjectMembers(stranger, project.id), []);
  });
});
