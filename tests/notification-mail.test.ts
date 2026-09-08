import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import {
  composeNotificationMail,
  type PendingNotification,
} from '#features/notification/mail.ts';
import {
  deliverPendingNotifications,
  MAX_ATTEMPTS,
  RECIPIENTS_PER_PASS,
} from '#features/notification/mailer.ts';
import { pool } from '#lib/db.ts';
import { type Mail, MailFailure, type MailSender } from '#lib/mail.ts';

/*
 * 通知メール。
 *
 * 確かめたいのは三つある。
 *
 * 一つめは、送らないと決めた行がきちんと畳まれること。
 * 拾う順は古い順なので、畳み忘れた行が先頭に居座ると、
 * その後ろに並んだ人の通知が永久に順番待ちになる。
 *
 * 二つめは、送る直前にも閲覧の判定がかかること。
 * 行を作るときにも絞っているが、そこから送るまでのあいだにも権限は動く。
 * メールは取り消せない。
 *
 * 三つめは、恒久的な失敗と一時的な失敗が分かれること。
 * 回数だけで諦めると、SMTP が数分止まった間の通知がまとめて捨てられる。
 *
 * 巡回は組織を絞らない。仕組みとして絞れない（宛先は組織をまたぐ）。
 * 並行して走る他のテストの行も掴むので、
 * 確かめるのは自分が作った宛先ぶんだけにしてある。
 * 拾う順が古い順であることを使い、自分の行は一日前に置いている。
 */

const TAG = `mail-${process.pid}`;
let seq = 0;
const uniq = (): string => {
  seq += 1;
  return `${TAG}-${seq}`;
};

let keySeq = 0;
const newKey = (): string => {
  keySeq += 1;
  return `M${keySeq}`;
};

const ORIGIN = 'https://tasktasktask.work';

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
   文面

   データベースを通さない。三件まとまったときの書き方を確かめるのに
   下ごしらえが要る状態にすると、誰も書き方を確かめなくなる。
   -------------------------------------------------------------------------- */

function pending(overrides: Partial<PendingNotification> = {}): PendingNotification {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    kind: 'mention',
    organizationName: '株式会社アクメ',
    slug: 'acme',
    projectKey: 'WEB',
    number: 3,
    title: '検索の要件をどうするか',
    actorName: '田中 亮',
    commentId: 'c0000000-0000-0000-0000-000000000001',
    commentBody: '検索の対象をどこまで広げるか決めたい。',
    ...overrides,
  };
}

describe('文面', () => {
  it('一件ならコメントの冒頭が入る', () => {
    const mail = composeNotificationMail('asuka@example.com', [pending()], ORIGIN);

    assert.equal(mail.to, 'asuka@example.com');
    assert.equal(mail.subject, '[WEB-3] 検索の要件をどうするか');
    assert.match(mail.text, /田中 亮 さんが WEB-3 であなたをメンションしました。/);
    assert.match(mail.text, /^> 検索の対象をどこまで広げるか決めたい。$/m);
    assert.match(mail.text, /https:\/\/tasktasktask\.work\/o\/acme\/p\/WEB\/t\/3#c-/);
  });

  it('長いコメントは途中で切る', () => {
    const body = ['一行目', '二行目', '三行目', '四行目', '五行目'].join('\n');
    const mail = composeNotificationMail(
      'a@example.com',
      [pending({ commentBody: body })],
      ORIGIN,
    );

    assert.match(mail.text, /^> 四行目$/m);
    assert.doesNotMatch(mail.text, /五行目/);
    assert.match(mail.text, /^> …$/m);
  });

  it('消されたコメントは引用しない', () => {
    const mail = composeNotificationMail(
      'a@example.com',
      [pending({ commentBody: null })],
      ORIGIN,
    );

    assert.doesNotMatch(mail.text, /^>/m);
    // 呼びかけが消えても、呼ばれたことは起きた出来事である
    assert.match(mail.text, /あなたをメンションしました/);
  });

  it('担当者の通知は、スレッドの先頭へ送る', () => {
    const mail = composeNotificationMail(
      'a@example.com',
      [pending({ kind: 'assigned', commentId: null, commentBody: null })],
      ORIGIN,
    );

    assert.match(mail.text, /あなたを担当者に設定しました/);
    assert.match(mail.text, /\/o\/acme\/p\/WEB\/t\/3$/m);
  });

  it('まとめると、本文は載らず見出しだけ並ぶ', () => {
    const mail = composeNotificationMail(
      'a@example.com',
      [pending(), pending({ id: 'x', number: 5, title: '認証の方式', kind: 'comment' })],
      ORIGIN,
    );

    assert.equal(mail.subject, 'TASK3 に 2 件の通知があります');
    assert.doesNotMatch(mail.text, /検索の対象をどこまで/);
    assert.match(mail.text, /田中 亮 さんがあなたをメンションしました/);
    assert.match(mail.text, /ウォッチ中のスレッドに新しいコメントがあります/);
    assert.match(mail.text, /WEB-5 認証の方式/);
  });

  it('組織をまたぐときだけ、組織名を添える', () => {
    const one = composeNotificationMail('a@example.com', [pending(), pending()], ORIGIN);
    assert.doesNotMatch(one.text, /【株式会社アクメ】/);

    const two = composeNotificationMail(
      'a@example.com',
      [pending(), pending({ organizationName: '合同会社ボレアリス', slug: 'bore' })],
      ORIGIN,
    );
    assert.match(two.text, /【株式会社アクメ】/);
    assert.match(two.text, /【合同会社ボレアリス】/);
  });

  it('止め方を末尾に書く', () => {
    const mail = composeNotificationMail('a@example.com', [pending()], ORIGIN);

    assert.match(mail.text, /このメールには返信できません。/);
    assert.match(mail.text, /通知メールを止める: https:\/\/tasktasktask\.work\/me/);
  });
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

async function member(
  org: Org,
  options: { admin?: boolean; email?: boolean } = {},
): Promise<{ id: string; email: string }> {
  const email = `${uniq()}@example.com`;
  const id = await value(
    'INSERT INTO users (email, display_name, email_notifications_enabled) VALUES ($1,$2,$3) RETURNING id',
    [email, '佐藤 明日香', options.email ?? true],
  );
  await pool.query(
    'INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,$3)',
    [org.id, id, options.admin ? 'admin' : 'member'],
  );
  return { id, email };
}

async function newProject(
  org: Org,
  creator: string,
  visibility: 'public' | 'private' = 'public',
): Promise<string> {
  return value(
    `INSERT INTO projects (organization_id, key, name, visibility, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [org.id, newKey(), '検索基盤の刷新', visibility, creator],
  );
}

async function addThread(org: Org, projectId: string, creator: string): Promise<string> {
  const number = await value<string>(
    `UPDATE organizations SET next_thread_number = next_thread_number + 1
      WHERE id = $1 RETURNING next_thread_number - 1`,
    [org.id],
  );
  return value(
    `INSERT INTO threads (organization_id, project_id, number, type, title, body, created_by_user_id)
     VALUES ($1,$2,$3,'kadai','検索の設計','',$4) RETURNING id`,
    [org.id, projectId, Number(number), creator],
  );
}

/**
 * 未送信の行を一つ置く。
 *
 * 既定で一日前に置いてある。並行して走る他のテストが積んだ行より
 * 古くなるので、一巡の枠を先に取れる。
 */
async function plant(
  org: Org,
  userId: string,
  threadId: string,
  options: { actor?: string; read?: boolean; attempts?: number; ageDays?: number } = {},
): Promise<string> {
  return value(
    `INSERT INTO notifications
       (organization_id, user_id, kind, thread_id, actor_user_id, read_at, email_attempts, created_at)
     VALUES ($1,$2,'assigned',$3,$4,$5,$6, now() - ($7 || ' days')::interval) RETURNING id`,
    [
      org.id,
      userId,
      threadId,
      options.actor ?? null,
      options.read ? new Date() : null,
      options.attempts ?? 0,
      String(options.ageDays ?? 1),
    ],
  );
}

async function stateOf(id: string) {
  const { rows } = await pool.query<{
    emailed: boolean;
    gaveUp: boolean;
    attempts: number;
  }>(
    `SELECT emailed_at IS NOT NULL AS emailed,
            email_gave_up_at IS NOT NULL AS "gaveUp",
            email_attempts AS attempts
       FROM notifications WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) {
    throw new Error('通知が見つかりません');
  }
  return row;
}

/** 記録するだけの送信先。失敗を仕込める。 */
class Recorder implements MailSender {
  readonly sent: Mail[] = [];
  readonly fail: MailFailure | null;

  constructor(fail: MailFailure | null = null) {
    this.fail = fail;
  }

  async send(mail: Mail): Promise<void> {
    if (this.fail) {
      throw this.fail;
    }
    this.sent.push(mail);
  }
}

/** 自分が作った宛先ぶんだけを見る。他のテストの行も同じ巡回に乗る。 */
function mine(recorder: Recorder, email: string): Mail[] {
  return recorder.sent.filter((mail) => mail.to === email);
}

async function stage(visibility: 'public' | 'private' = 'public') {
  const org = await newOrg();
  const admin = await member(org, { admin: true });
  const to = await member(org);
  const project = await newProject(org, admin.id, visibility);
  if (visibility === 'private') {
    await pool.query('INSERT INTO project_members (project_id, user_id) VALUES ($1,$2)', [
      project,
      to.id,
    ]);
  }
  const thread = await addThread(org, project, admin.id);
  return { org, admin, to, project, thread };
}

/* --------------------------------------------------------------------------
   巡回
   -------------------------------------------------------------------------- */

describe('送るもの', () => {
  it('未送信の行が届き、emailed_at が入る', async () => {
    const { org, admin, to, thread } = await stage();
    const id = await plant(org, to.id, thread, { actor: admin.id });

    const recorder = new Recorder();
    await deliverPendingNotifications(recorder, ORIGIN);

    assert.equal(mine(recorder, to.email).length, 1);
    assert.deepEqual(await stateOf(id), { emailed: true, gaveUp: false, attempts: 1 });
  });

  it('同じ人あての行は一通にまとまる', async () => {
    const { org, admin, to, thread } = await stage();
    await plant(org, to.id, thread, { actor: admin.id });
    await plant(org, to.id, thread, { actor: admin.id });
    await plant(org, to.id, thread, { actor: admin.id });

    const recorder = new Recorder();
    await deliverPendingNotifications(recorder, ORIGIN);

    const mails = mine(recorder, to.email);
    assert.equal(mails.length, 1);
    assert.equal(mails[0]?.subject, 'TASK3 に 3 件の通知があります');
  });

  it('一度送った行は、次の巡回で拾われない', async () => {
    const { org, admin, to, thread } = await stage();
    await plant(org, to.id, thread, { actor: admin.id });

    await deliverPendingNotifications(new Recorder(), ORIGIN);

    const second = new Recorder();
    await deliverPendingNotifications(second, ORIGIN);
    assert.deepEqual(mine(second, to.email), []);
  });
});

describe('送らないと決めるもの', () => {
  /*
   * どれも、送らないだけでは足りない。決着を付けないと索引に残る。
   * 拾う順は古い順なので、居座った行が枠を先に取り続ける。
   */
  const settled = { emailed: false, gaveUp: true, attempts: 0 };

  it('アプリで先に読まれた行', async () => {
    const { org, admin, to, thread } = await stage();
    const id = await plant(org, to.id, thread, { actor: admin.id, read: true });

    const recorder = new Recorder();
    await deliverPendingNotifications(recorder, ORIGIN);

    assert.deepEqual(mine(recorder, to.email), []);
    assert.deepEqual(await stateOf(id), settled);
  });

  it('メール通知を切っている人', async () => {
    const org = await newOrg();
    const admin = await member(org, { admin: true });
    const to = await member(org, { email: false });
    const project = await newProject(org, admin.id);
    const thread = await addThread(org, project, admin.id);
    const id = await plant(org, to.id, thread, { actor: admin.id });

    const recorder = new Recorder();
    await deliverPendingNotifications(recorder, ORIGIN);

    assert.deepEqual(mine(recorder, to.email), []);
    assert.deepEqual(await stateOf(id), settled);
  });

  it('見えなくなったプロジェクトの行', async () => {
    const { org, admin, to, project, thread } = await stage('private');
    const id = await plant(org, to.id, thread, { actor: admin.id });

    // 担当のまま、プロジェクトから外される経路がある
    await pool.query(
      `UPDATE project_members SET deleted_at = now() WHERE project_id = $1 AND user_id = $2`,
      [project, to.id],
    );

    const recorder = new Recorder();
    await deliverPendingNotifications(recorder, ORIGIN);

    // 本文にはスレッドのタイトルが入る。ここが最後の砦になる
    assert.deepEqual(mine(recorder, to.email), []);
    assert.deepEqual(await stateOf(id), settled);
  });

  it('組織から外れた人の行', async () => {
    const { org, admin, to, thread } = await stage();
    const id = await plant(org, to.id, thread, { actor: admin.id });

    await pool.query(
      `UPDATE organization_members SET deleted_at = now()
        WHERE organization_id = $1 AND user_id = $2`,
      [org.id, to.id],
    );

    const recorder = new Recorder();
    await deliverPendingNotifications(recorder, ORIGIN);

    assert.deepEqual(mine(recorder, to.email), []);
    assert.deepEqual(await stateOf(id), settled);
  });

  it('消されたスレッドの行', async () => {
    const { org, admin, to, thread } = await stage();
    const id = await plant(org, to.id, thread, { actor: admin.id });
    await pool.query(
      `UPDATE threads SET archived_at = now(), deleted_at = now() WHERE id = $1`,
      [thread],
    );

    const recorder = new Recorder();
    await deliverPendingNotifications(recorder, ORIGIN);

    assert.deepEqual(mine(recorder, to.email), []);
    assert.deepEqual(await stateOf(id), settled);
  });
});

describe('送れなかったとき', () => {
  it('宛先を拒まれたら、その場で諦める', async () => {
    const { org, admin, to, thread } = await stage();
    const id = await plant(org, to.id, thread, { actor: admin.id });

    const broken = new Recorder(new MailFailure('550 no such user', { permanent: true }));
    await deliverPendingNotifications(broken, ORIGIN);

    assert.deepEqual(await stateOf(id), { emailed: false, gaveUp: true, attempts: 1 });
  });

  it('一時的な失敗なら、次の巡回でもう一度試す', async () => {
    const { org, admin, to, thread } = await stage();
    const id = await plant(org, to.id, thread, { actor: admin.id });

    const busy = new Recorder(new MailFailure('451 try again', { permanent: false }));
    await deliverPendingNotifications(busy, ORIGIN);
    assert.deepEqual(await stateOf(id), { emailed: false, gaveUp: false, attempts: 1 });

    // 数回で諦めると、SMTP が数分止まっただけで通知が捨てられる
    const recorder = new Recorder();
    await deliverPendingNotifications(recorder, ORIGIN);
    assert.equal(mine(recorder, to.email).length, 1);
    assert.deepEqual(await stateOf(id), { emailed: true, gaveUp: false, attempts: 2 });
  });

  it('試行が上限に達したら諦める', async () => {
    const { org, admin, to, thread } = await stage();
    const id = await plant(org, to.id, thread, {
      actor: admin.id,
      attempts: MAX_ATTEMPTS - 1,
    });

    const busy = new Recorder(new MailFailure('451 try again', { permanent: false }));
    await deliverPendingNotifications(busy, ORIGIN);

    assert.deepEqual(await stateOf(id), {
      emailed: false,
      gaveUp: true,
      attempts: MAX_ATTEMPTS,
    });
  });
});

describe('一巡で拾う量', () => {
  it('宛先の数で打ち切り、あふれた分は次の巡回が拾う', async () => {
    const org = await newOrg();
    const admin = await member(org, { admin: true });
    const project = await newProject(org, admin.id);
    const thread = await addThread(org, project, admin.id);

    // 枠より一人多く用意する
    const people: { id: string; email: string }[] = [];
    for (let i = 0; i <= RECIPIENTS_PER_PASS; i += 1) {
      const to = await member(org);
      await plant(org, to.id, thread, { actor: admin.id, ageDays: 2 });
      people.push(to);
    }

    const delivered = new Set<string>();
    const collect = (recorder: Recorder): void => {
      for (const person of people) {
        if (mine(recorder, person.email).length > 0) {
          delivered.add(person.email);
        }
      }
    };

    const first = new Recorder();
    await deliverPendingNotifications(first, ORIGIN);
    collect(first);

    // 巡回は組織を絞らない。絞れない（宛先は組織をまたぐ）。
    // 並行して走る他のテストの行も同じ枠を使うので、
    // 数えるのは通の総数にしてある。自分の分だけでは足りない
    assert.ok(
      first.sent.length <= RECIPIENTS_PER_PASS,
      `一巡で ${first.sent.length} 通送られました`,
    );
    assert.ok(delivered.size < people.length, '一巡で全員に届いてしまいました');

    // 打ち切られた人も、あとの巡回で届く。ここで落ちると永久に届かない
    for (let round = 0; round < 5 && delivered.size < people.length; round += 1) {
      const next = new Recorder();
      await deliverPendingNotifications(next, ORIGIN);
      collect(next);
    }
    assert.equal(delivered.size, people.length);
  });
});
