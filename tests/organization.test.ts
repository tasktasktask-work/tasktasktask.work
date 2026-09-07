import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { hashToken, issueToken } from '#features/authentication/token.ts';
import {
  acceptInvitation,
  inviteMember,
  listPendingInvitations,
  previewInvitation,
  revokeInvitation,
} from '#features/organization/invitations.ts';
import {
  changeMemberRole,
  getOrganization,
  listMembers,
  listMemberships,
  type MemberRole,
  removeMember,
  renameOrganization,
  resolveScope,
} from '#features/organization/queries.ts';
import { type OrgScope, pool, VISIBLE_PROJECT_IDS } from '#lib/db.ts';

/*
 * 組織と、そこへの所属。
 *
 * 組織はデータの境界である。所属が切れた人に何かが見えたら、それは事故である。
 * 権限の判定はすべて SQL の中にあり、呼ぶ側が組み立てたスコープを信用しない。
 * その「信用しない」を、偽のスコープを渡すテストで固定してある。
 *
 * ここで扱う関数は pool を直に使うので、トランザクションで巻き戻せない。
 * 作った行は印を付けておき、最後にまとめて消す。
 */

const TAG = `orgt-${process.pid}`;
let seq = 0;
const uniq = (): string => {
  seq += 1;
  return `${TAG}-${seq}`;
};

after(async () => {
  const like = `${TAG}-%`;
  // 外部キーの向きに沿って落とす
  await pool.query(
    `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [like],
  );
  await pool.query(
    `DELETE FROM magic_link_tokens WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)`,
    [like],
  );
  await pool.query(
    `DELETE FROM invitations WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE $1)`,
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

async function newOrg(name = '株式会社アクメ'): Promise<Org> {
  const slug = uniq();
  const id = await value('INSERT INTO organizations (name, slug) VALUES ($1,$2) RETURNING id', [
    name,
    slug,
  ]);
  return { id, slug };
}

async function newUser(name: string, email = `${uniq()}@example.com`): Promise<string> {
  return value('INSERT INTO users (email, display_name) VALUES ($1,$2) RETURNING id', [
    email,
    name,
  ]);
}

async function join(org: Org, user: string, role: MemberRole, removed = false): Promise<void> {
  await pool.query(
    `INSERT INTO organization_members (organization_id, user_id, role, deleted_at)
     VALUES ($1,$2,$3,$4)`,
    [org.id, user, role, removed ? new Date() : null],
  );
}

/** 実際に所属から組み立てたスコープ。無ければ落とす。 */
async function scopeOf(org: Org, user: string): Promise<OrgScope> {
  const scope = await resolveScope(user, org.slug);
  assert.ok(scope, 'スコープを組み立てられませんでした');
  return scope;
}

/** 呼ぶ側が偽ったスコープ。SQL 側が信用しないことを確かめるために使う。 */
function fakedAdminScope(org: Org, user: string): OrgScope {
  return { organizationId: org.id, userId: user, isOrgAdmin: true, timezone: 'Asia/Tokyo' };
}

async function newInvitation(
  org: Org,
  email: string,
  role: MemberRole,
  invitedBy: string,
  options: { hoursLeft?: number; revoked?: boolean; accepted?: string } = {},
): Promise<{ id: string; token: string }> {
  const { token, hash } = issueToken();
  const hours = options.hoursLeft ?? 48;
  const id = await value(
    `INSERT INTO invitations
       (organization_id, email, role, invited_by_user_id, token_hash, expires_at,
        revoked_at, accepted_at, accepted_user_id)
     VALUES ($1,$2,$3,$4,$5, now() + ($6 || ' hours')::interval, $7, $8, $9)
     RETURNING id`,
    [
      org.id,
      email,
      role,
      invitedBy,
      hash,
      String(hours),
      options.revoked ? new Date() : null,
      options.accepted ? new Date() : null,
      options.accepted ?? null,
    ],
  );
  return { id, token };
}

async function visibleTo(org: Org, user: string): Promise<Set<string>> {
  const { rows } = await pool.query<{ id: string }>(VISIBLE_PROJECT_IDS, [org.id, user]);
  return new Set(rows.map((r) => r.id));
}

/* --------------------------------------------------------------------------
   スコープ
   -------------------------------------------------------------------------- */

describe('組織のスコープ', () => {
  it('メンバーなら組み立てられる', async () => {
    const org = await newOrg();
    const user = await newUser('佐藤 明日香');
    await join(org, user, 'member');

    const scope = await resolveScope(user, org.slug);
    assert.ok(scope);
    assert.equal(scope.organizationId, org.id);
    assert.equal(scope.userId, user);
    assert.equal(scope.isOrgAdmin, false);
    assert.equal(scope.timezone, 'Asia/Tokyo');
  });

  it('組織管理者なら isOrgAdmin が立つ', async () => {
    const org = await newOrg();
    const admin = await newUser('田中 亮');
    await join(org, admin, 'admin');

    const scope = await resolveScope(admin, org.slug);
    assert.equal(scope?.isOrgAdmin, true);
  });

  it('所属していない人には組み立てられない', async () => {
    const org = await newOrg();
    const outsider = await newUser('部外者');

    assert.equal(await resolveScope(outsider, org.slug), null);
  });

  it('外された人には組み立てられない', async () => {
    const org = await newOrg();
    const leaver = await newUser('辞めた人');
    await join(org, leaver, 'admin', true);

    assert.equal(await resolveScope(leaver, org.slug), null);
  });

  it('存在しない slug では組み立てられない', async () => {
    const user = await newUser('佐藤 明日香');
    assert.equal(await resolveScope(user, `${TAG}-nowhere`), null);
  });

  it('論理削除された組織では組み立てられない', async () => {
    const org = await newOrg();
    const admin = await newUser('田中 亮');
    await join(org, admin, 'admin');
    await pool.query('UPDATE organizations SET deleted_at = now() WHERE id = $1', [org.id]);

    assert.equal(await resolveScope(admin, org.slug), null);
  });

  it('所属している組織だけが並ぶ', async () => {
    const acme = await newOrg('株式会社アクメ');
    const other = await newOrg('別の会社');
    const gone = await newOrg('抜けた会社');
    const user = await newUser('掛け持ちの人');
    await join(acme, user, 'admin');
    await join(gone, user, 'member', true);

    const list = await listMemberships(user);
    assert.deepEqual(
      list.map((m) => m.organizationId),
      [acme.id],
    );
    assert.equal(list[0]?.role, 'admin');
    assert.ok(!list.some((m) => m.organizationId === other.id));
  });
});

/* --------------------------------------------------------------------------
   メンバー一覧
   -------------------------------------------------------------------------- */

describe('メンバー一覧', () => {
  it('組織管理者にはメールアドレスまで見える', async () => {
    const org = await newOrg();
    const admin = await newUser('田中 亮');
    await join(org, admin, 'admin');

    const rows = await listMembers(await scopeOf(org, admin));
    assert.equal(rows.length, 1);
    assert.ok(rows[0]?.email?.includes('@'));
  });

  it('メンバーにはメールアドレスを返さない', async () => {
    const org = await newOrg();
    const admin = await newUser('田中 亮');
    const member = await newUser('佐藤 明日香');
    await join(org, admin, 'admin');
    await join(org, member, 'member');

    const rows = await listMembers(await scopeOf(org, member));
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => r.email === null));
  });

  it('isOrgAdmin を偽っても、メールアドレスは見えない', async () => {
    const org = await newOrg();
    const admin = await newUser('田中 亮');
    const member = await newUser('佐藤 明日香');
    await join(org, admin, 'admin');
    await join(org, member, 'member');

    const rows = await listMembers(fakedAdminScope(org, member));
    assert.ok(
      rows.every((r) => r.email === null),
      '偽ったスコープでメールアドレスが漏れた',
    );
  });

  it('外された人は並ばない', async () => {
    const org = await newOrg();
    const admin = await newUser('田中 亮');
    const leaver = await newUser('辞めた人');
    await join(org, admin, 'admin');
    await join(org, leaver, 'member', true);

    const rows = await listMembers(await scopeOf(org, admin));
    assert.deepEqual(
      rows.map((r) => r.userId),
      [admin],
    );
  });
});

/* --------------------------------------------------------------------------
   役割
   -------------------------------------------------------------------------- */

describe('役割の変更', () => {
  it('組織管理者は役割を変えられる', async () => {
    const org = await newOrg();
    const admin = await newUser('田中 亮');
    const member = await newUser('佐藤 明日香');
    await join(org, admin, 'admin');
    await join(org, member, 'member');

    assert.deepEqual(await changeMemberRole(await scopeOf(org, admin), member, 'admin'), {
      ok: true,
    });
    const scope = await resolveScope(member, org.slug);
    assert.equal(scope?.isOrgAdmin, true);
  });

  it('メンバーには変えられない', async () => {
    const org = await newOrg();
    const admin = await newUser('田中 亮');
    const member = await newUser('佐藤 明日香');
    await join(org, admin, 'admin');
    await join(org, member, 'member');

    const result = await changeMemberRole(await scopeOf(org, member), member, 'admin');
    assert.deepEqual(result, { ok: false, reason: 'forbidden' });
  });

  it('isOrgAdmin を偽っても変えられない', async () => {
    const org = await newOrg();
    const admin = await newUser('田中 亮');
    const member = await newUser('佐藤 明日香');
    await join(org, admin, 'admin');
    await join(org, member, 'member');

    const result = await changeMemberRole(fakedAdminScope(org, member), member, 'admin');
    assert.deepEqual(result, { ok: false, reason: 'forbidden' });
  });

  it('最後の組織管理者は降ろせない', async () => {
    const org = await newOrg();
    const admin = await newUser('ひとりだけの管理者');
    await join(org, admin, 'admin');

    const result = await changeMemberRole(await scopeOf(org, admin), admin, 'member');
    assert.deepEqual(result, { ok: false, reason: 'last-admin' });
    assert.equal((await resolveScope(admin, org.slug))?.isOrgAdmin, true);
  });

  it('管理者が二人いれば降ろせる', async () => {
    const org = await newOrg();
    const one = await newUser('管理者A');
    const two = await newUser('管理者B');
    await join(org, one, 'admin');
    await join(org, two, 'admin');

    assert.deepEqual(await changeMemberRole(await scopeOf(org, one), two, 'member'), {
      ok: true,
    });
  });

  it('外された人は役割を変える相手にならない', async () => {
    const org = await newOrg();
    const admin = await newUser('田中 亮');
    const leaver = await newUser('辞めた人');
    await join(org, admin, 'admin');
    await join(org, leaver, 'member', true);

    const result = await changeMemberRole(await scopeOf(org, admin), leaver, 'admin');
    assert.deepEqual(result, { ok: false, reason: 'not-member' });
  });
});

/* --------------------------------------------------------------------------
   外す
   -------------------------------------------------------------------------- */

describe('メンバーを外す', () => {
  it('最後の組織管理者は外せない', async () => {
    const org = await newOrg();
    const admin = await newUser('ひとりだけの管理者');
    await join(org, admin, 'admin');

    const result = await removeMember(await scopeOf(org, admin), admin);
    assert.deepEqual(result, { ok: false, reason: 'last-admin' });
  });

  it('外すと、その組織のスコープを組み立てられなくなる', async () => {
    const org = await newOrg();
    const admin = await newUser('田中 亮');
    const member = await newUser('佐藤 明日香');
    await join(org, admin, 'admin');
    await join(org, member, 'member');

    assert.deepEqual(await removeMember(await scopeOf(org, admin), member), { ok: true });
    assert.equal(await resolveScope(member, org.slug), null);
  });

  it('外すと、非公開プロジェクトも見えなくなる', async () => {
    const org = await newOrg();
    const admin = await newUser('田中 亮');
    const member = await newUser('佐藤 明日香');
    await join(org, admin, 'admin');
    await join(org, member, 'member');

    const project = await value(
      `INSERT INTO projects (organization_id, key, name, created_by_user_id, visibility)
       VALUES ($1,'BILL','請求まわり',$2,'private') RETURNING id`,
      [org.id, admin],
    );
    await pool.query('INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)', [
      project,
      member,
    ]);

    assert.ok((await visibleTo(org, member)).has(project), '外す前は見えているはず');

    await removeMember(await scopeOf(org, admin), member);

    assert.ok(!(await visibleTo(org, member)).has(project));

    // 権限のためではないが、意味を失った行は畳んでおく
    const live = await value<string>(
      `SELECT count(*)::text FROM project_members
        WHERE project_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [project, member],
    );
    assert.equal(live, '0');
  });

  it('isOrgAdmin を偽っても外せない', async () => {
    const org = await newOrg();
    const admin = await newUser('田中 亮');
    const member = await newUser('佐藤 明日香');
    await join(org, admin, 'admin');
    await join(org, member, 'member');

    const result = await removeMember(fakedAdminScope(org, member), admin);
    assert.deepEqual(result, { ok: false, reason: 'forbidden' });
    assert.ok(await resolveScope(admin, org.slug));
  });
});

/* --------------------------------------------------------------------------
   組織の設定
   -------------------------------------------------------------------------- */

describe('組織の設定', () => {
  it('組織管理者は名前を変えられる', async () => {
    const org = await newOrg('古い名前');
    const admin = await newUser('田中 亮');
    await join(org, admin, 'admin');

    const scope = await scopeOf(org, admin);
    assert.deepEqual(await renameOrganization(scope, '新しい名前'), { ok: true });
    assert.equal((await getOrganization(scope)).name, '新しい名前');
  });

  it('メンバーには変えられない', async () => {
    const org = await newOrg('古い名前');
    const admin = await newUser('田中 亮');
    const member = await newUser('佐藤 明日香');
    await join(org, admin, 'admin');
    await join(org, member, 'member');

    const result = await renameOrganization(await scopeOf(org, member), '乗っ取り');
    assert.deepEqual(result, { ok: false, reason: 'forbidden' });
    assert.equal((await getOrganization(await scopeOf(org, admin))).name, '古い名前');
  });

  it('isOrgAdmin を偽っても変えられない', async () => {
    const org = await newOrg('古い名前');
    const admin = await newUser('田中 亮');
    const member = await newUser('佐藤 明日香');
    await join(org, admin, 'admin');
    await join(org, member, 'member');

    const result = await renameOrganization(fakedAdminScope(org, member), '乗っ取り');
    assert.deepEqual(result, { ok: false, reason: 'forbidden' });
  });

  it('空白だけの名前は受け付けない', async () => {
    const org = await newOrg('古い名前');
    const admin = await newUser('田中 亮');
    await join(org, admin, 'admin');

    const result = await renameOrganization(await scopeOf(org, admin), '   ');
    assert.deepEqual(result, { ok: false, reason: 'invalid-name' });
  });
});

/* --------------------------------------------------------------------------
   招待を送る
   -------------------------------------------------------------------------- */

describe('招待を送る', () => {
  it('組織管理者は招待を作れる', async () => {
    const org = await newOrg();
    const admin = await newUser('田中 亮');
    await join(org, admin, 'admin');

    const email = `${uniq()}@example.com`;
    assert.deepEqual(await inviteMember(await scopeOf(org, admin), email, 'member'), {
      ok: true,
    });

    const pending = await listPendingInvitations(await scopeOf(org, admin));
    assert.deepEqual(
      pending.map((p) => p.email),
      [email],
    );
  });

  it('メンバーには送れない', async () => {
    const org = await newOrg();
    const admin = await newUser('田中 亮');
    const member = await newUser('佐藤 明日香');
    await join(org, admin, 'admin');
    await join(org, member, 'member');

    const result = await inviteMember(
      await scopeOf(org, member),
      `${uniq()}@example.com`,
      'admin',
    );
    assert.deepEqual(result, { ok: false, reason: 'forbidden' });
  });

  it('isOrgAdmin を偽っても送れない', async () => {
    const org = await newOrg();
    const admin = await newUser('田中 亮');
    const member = await newUser('佐藤 明日香');
    await join(org, admin, 'admin');
    await join(org, member, 'member');

    const result = await inviteMember(
      fakedAdminScope(org, member),
      `${uniq()}@example.com`,
      'admin',
    );
    assert.deepEqual(result, { ok: false, reason: 'forbidden' });
  });

  it('すでにメンバーの相手は招待できない', async () => {
    const org = await newOrg();
    const admin = await newUser('田中 亮');
    const email = `${uniq()}@example.com`;
    const member = await newUser('佐藤 明日香', email);
    await join(org, admin, 'admin');
    await join(org, member, 'member');

    const result = await inviteMember(await scopeOf(org, admin), email, 'member');
    assert.deepEqual(result, { ok: false, reason: 'already-member' });
  });

  it('同じ相手への未処理の招待は一件まで', async () => {
    const org = await newOrg();
    const admin = await newUser('田中 亮');
    await join(org, admin, 'admin');

    const scope = await scopeOf(org, admin);
    const email = `${uniq()}@example.com`;
    assert.deepEqual(await inviteMember(scope, email, 'member'), { ok: true });
    assert.deepEqual(await inviteMember(scope, email, 'admin'), {
      ok: false,
      reason: 'already-invited',
    });
  });

  it('大文字で書かれたメールアドレスは小文字に揃える', async () => {
    const org = await newOrg();
    const admin = await newUser('田中 亮');
    await join(org, admin, 'admin');

    const scope = await scopeOf(org, admin);
    const lower = `${uniq()}@example.com`;
    assert.deepEqual(await inviteMember(scope, lower.toUpperCase(), 'member'), { ok: true });

    const pending = await listPendingInvitations(scope);
    assert.deepEqual(
      pending.map((p) => p.email),
      [lower],
    );
  });

  it('形になっていないメールアドレスは受け付けない', async () => {
    const org = await newOrg();
    const admin = await newUser('田中 亮');
    await join(org, admin, 'admin');

    const result = await inviteMember(await scopeOf(org, admin), 'not-an-address', 'member');
    assert.deepEqual(result, { ok: false, reason: 'invalid-email' });
  });

  it('招待の一覧は組織管理者にしか返らない', async () => {
    const org = await newOrg();
    const admin = await newUser('田中 亮');
    const member = await newUser('佐藤 明日香');
    await join(org, admin, 'admin');
    await join(org, member, 'member');
    await newInvitation(org, `${uniq()}@example.com`, 'member', admin);

    assert.equal((await listPendingInvitations(await scopeOf(org, member))).length, 0);
    assert.equal((await listPendingInvitations(fakedAdminScope(org, member))).length, 0);
    assert.equal((await listPendingInvitations(await scopeOf(org, admin))).length, 1);
  });

  it('取り消すと一覧から消え、リンクも使えなくなる', async () => {
    const org = await newOrg();
    const admin = await newUser('田中 亮');
    await join(org, admin, 'admin');
    const invitation = await newInvitation(org, `${uniq()}@example.com`, 'member', admin);

    const scope = await scopeOf(org, admin);
    assert.deepEqual(await revokeInvitation(scope, invitation.id), { ok: true });
    assert.equal((await listPendingInvitations(scope)).length, 0);
    assert.deepEqual(await previewInvitation(invitation.token), {
      ok: false,
      reason: 'revoked',
    });
  });

  it('メンバーには取り消せない', async () => {
    const org = await newOrg();
    const admin = await newUser('田中 亮');
    const member = await newUser('佐藤 明日香');
    await join(org, admin, 'admin');
    await join(org, member, 'member');
    const invitation = await newInvitation(org, `${uniq()}@example.com`, 'member', admin);

    const result = await revokeInvitation(await scopeOf(org, member), invitation.id);
    assert.deepEqual(result, { ok: false, reason: 'not-found' });
  });
});

/* --------------------------------------------------------------------------
   招待を受ける
   -------------------------------------------------------------------------- */

describe('招待を受ける', () => {
  it('アカウントが無ければ作られ、所属とセッションができる', async () => {
    const org = await newOrg();
    const admin = await newUser('田中 亮');
    await join(org, admin, 'admin');
    const email = `${uniq()}@example.com`;
    const invitation = await newInvitation(org, email, 'admin', admin);

    const preview = await previewInvitation(invitation.token);
    assert.ok(preview.ok);
    assert.equal(preview.preview.needsAccount, true);
    assert.equal(preview.preview.email, email);
    assert.equal(preview.preview.role, 'admin');

    const result = await acceptInvitation(invitation.token, {
      displayName: '新しい人',
      password: 'correct-horse-battery',
    });
    assert.ok(result.ok);
    assert.equal(result.createdAccount, true);
    assert.equal(result.slug, org.slug);

    // 招待に書いてあった役割で入る
    assert.equal((await resolveScope(result.userId, org.slug))?.isOrgAdmin, true);

    // セッションは実際に記録されている
    const sessions = await value<string>(
      'SELECT count(*)::text FROM sessions WHERE token_hash = $1',
      [hashToken(result.session.token)],
    );
    assert.equal(sessions, '1');
  });

  it('表示名が無ければ受けられない', async () => {
    const org = await newOrg();
    const admin = await newUser('田中 亮');
    await join(org, admin, 'admin');
    const invitation = await newInvitation(org, `${uniq()}@example.com`, 'member', admin);

    assert.deepEqual(await acceptInvitation(invitation.token, { password: 'longenough1' }), {
      ok: false,
      reason: 'display-name-required',
    });
  });

  it('短いパスワードでは受けられない', async () => {
    const org = await newOrg();
    const admin = await newUser('田中 亮');
    await join(org, admin, 'admin');
    const invitation = await newInvitation(org, `${uniq()}@example.com`, 'member', admin);

    assert.deepEqual(
      await acceptInvitation(invitation.token, { displayName: '新しい人', password: 'short' }),
      { ok: false, reason: 'password-too-short' },
    );
  });

  it('すでにアカウントがあれば、パスワードは変わらない', async () => {
    const org = await newOrg();
    const admin = await newUser('田中 亮');
    await join(org, admin, 'admin');

    const email = `${uniq()}@example.com`;
    const existing = await newUser('別の組織にいる人', email);
    await pool.query(`UPDATE users SET password_hash = 'before' WHERE id = $1`, [existing]);

    const invitation = await newInvitation(org, email, 'member', admin);
    const preview = await previewInvitation(invitation.token);
    assert.ok(preview.ok);
    assert.equal(preview.preview.needsAccount, false);

    const result = await acceptInvitation(invitation.token, {
      displayName: 'すり替え',
      password: 'attackers-password',
    });
    assert.ok(result.ok);
    assert.equal(result.userId, existing);
    assert.equal(result.createdAccount, false);

    const after = await value<string>('SELECT password_hash FROM users WHERE id = $1', [
      existing,
    ]);
    assert.equal(after, 'before', 'パスワードが上書きされた');

    const name = await value<string>('SELECT display_name FROM users WHERE id = $1', [
      existing,
    ]);
    assert.equal(name, '別の組織にいる人', '表示名が上書きされた');
  });

  it('受けると、パスワードのロックが解ける', async () => {
    const org = await newOrg();
    const admin = await newUser('田中 亮');
    await join(org, admin, 'admin');

    const email = `${uniq()}@example.com`;
    const locked = await newUser('締め出された人', email);
    await pool.query(
      'UPDATE users SET failed_login_count = 10, locked_at = now() WHERE id = $1',
      [locked],
    );

    const invitation = await newInvitation(org, email, 'member', admin);
    assert.ok((await acceptInvitation(invitation.token)).ok);

    const lockedAt = await value<string | null>('SELECT locked_at FROM users WHERE id = $1', [
      locked,
    ]);
    assert.equal(lockedAt, null);
  });

  it('期限切れは受けられない', async () => {
    const org = await newOrg();
    const admin = await newUser('田中 亮');
    await join(org, admin, 'admin');
    const invitation = await newInvitation(org, `${uniq()}@example.com`, 'member', admin, {
      hoursLeft: -1,
    });

    assert.deepEqual(await previewInvitation(invitation.token), {
      ok: false,
      reason: 'expired',
    });
    assert.deepEqual(
      await acceptInvitation(invitation.token, { displayName: '人', password: 'longenough1' }),
      { ok: false, reason: 'expired' },
    );
  });

  it('取り消し済みは受けられない', async () => {
    const org = await newOrg();
    const admin = await newUser('田中 亮');
    await join(org, admin, 'admin');
    const invitation = await newInvitation(org, `${uniq()}@example.com`, 'member', admin, {
      revoked: true,
    });

    assert.deepEqual(
      await acceptInvitation(invitation.token, { displayName: '人', password: 'longenough1' }),
      { ok: false, reason: 'revoked' },
    );
  });

  it('一度使った招待は二度使えない', async () => {
    const org = await newOrg();
    const admin = await newUser('田中 亮');
    await join(org, admin, 'admin');
    const invitation = await newInvitation(org, `${uniq()}@example.com`, 'member', admin);

    assert.ok(
      (await acceptInvitation(invitation.token, { displayName: '人', password: 'longenough1' }))
        .ok,
    );
    assert.deepEqual(
      await acceptInvitation(invitation.token, { displayName: '人', password: 'longenough1' }),
      { ok: false, reason: 'used' },
    );
  });

  it('でたらめなトークンは受けられない', async () => {
    assert.deepEqual(await previewInvitation('でたらめ'), { ok: false, reason: 'invalid' });
    assert.deepEqual(await acceptInvitation('でたらめ'), { ok: false, reason: 'invalid' });
  });

  it('外れた人を呼び戻しても、生きた所属は一本だけになる', async () => {
    const org = await newOrg();
    const admin = await newUser('田中 亮');
    await join(org, admin, 'admin');

    const email = `${uniq()}@example.com`;
    const leaver = await newUser('戻ってきた人', email);
    await join(org, leaver, 'member', true);

    const invitation = await newInvitation(org, email, 'admin', admin);
    const result = await acceptInvitation(invitation.token);
    assert.ok(result.ok);
    assert.equal(result.userId, leaver);

    const live = await value<string>(
      `SELECT count(*)::text FROM organization_members
        WHERE organization_id = $1 AND user_id = $2 AND deleted_at IS NULL`,
      [org.id, leaver],
    );
    assert.equal(live, '1');
    assert.equal((await resolveScope(leaver, org.slug))?.isOrgAdmin, true);

    // 抜けていた記録は残す
    const folded = await value<string>(
      `SELECT count(*)::text FROM organization_members
        WHERE organization_id = $1 AND user_id = $2 AND deleted_at IS NOT NULL`,
      [org.id, leaver],
    );
    assert.equal(folded, '1');
  });
});
