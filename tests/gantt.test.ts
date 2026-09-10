import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import {
  addDays,
  computeRange,
  dayIndex,
  type GanttThread,
  monthBands,
  placeBar,
  selectRows,
  weekdayIndex,
} from '#features/gantt/layout.ts';
import { countThreads, listGanttThreads, listUndated } from '#features/gantt/queries.ts';
import type { MemberRole } from '#features/organization/queries.ts';
import type { ThreadType } from '#features/thread/queries.ts';
import { type OrgScope, pool } from '#lib/db.ts';

/*
 * ガントの確かめどころは二つに分かれる。
 *
 * 一つは、どの行を出すかである。期間を持つ課題を種にして親へ辿るので、
 * 「期間の無い親は残るが、期間の無い葉は残らない」という非対称ができる。
 * ここが崩れると、子のインデントの根拠が消えて行が宙に浮く。
 * データベースを使わずに確かめられるよう、layout.ts に分けてある。
 *
 * もう一つは、引くところで組織とプロジェクトの線を越えないことである。
 * こちらは実データベースで確かめる。
 */

const TAG = `gantt-${process.pid}`;
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
  await pool.query(`DELETE FROM notifications WHERE ${inOrg}`, [like]);
  await pool.query(`DELETE FROM threads WHERE ${inOrg}`, [like]);
  await pool.query(`DELETE FROM projects WHERE ${inOrg}`, [like]);
  await pool.query(`DELETE FROM organization_members WHERE ${inOrg}`, [like]);
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [like]);
  await pool.query(`DELETE FROM organizations WHERE slug LIKE $1`, [like]);
  await pool.end();
});

/* --------------------------------------------------------------------------
   下ごしらえ
   -------------------------------------------------------------------------- */

let fake = 0;

/** 図に出しうる課題を一つ組み立てる。id は見分けが付けば何でもよい。 */
function thread(over: Partial<GanttThread> & { id: string }): GanttThread {
  fake += 1;
  return {
    number: fake,
    title: `課題 ${over.id}`,
    progress: 0,
    startsOn: null,
    endsOn: null,
    assigneeName: null,
    archived: false,
    parentId: null,
    parentNumber: null,
    ...over,
  };
}

/** 期間を持つ課題。ガントの種になる形。 */
function dated(
  id: string,
  from: string,
  to: string,
  over: Partial<GanttThread> = {},
): GanttThread {
  return thread({ id, startsOn: from, endsOn: to, ...over });
}

const titles = (rows: readonly { thread: GanttThread }[]): string[] =>
  rows.map((row) => row.thread.id);

/* --------------------------------------------------------------------------
   日付
   -------------------------------------------------------------------------- */

describe('日付の計算', () => {
  it('同じ日は 0 日', () => {
    assert.equal(dayIndex('2026-09-08', '2026-09-08'), 0);
  });

  it('月をまたいでも日数で数える', () => {
    assert.equal(dayIndex('2026-10-01', '2026-09-28'), 3);
    assert.equal(dayIndex('2026-01-01', '2025-12-30'), 2);
  });

  it('うるう年の 2 月を越える', () => {
    assert.equal(dayIndex('2028-03-01', '2028-02-28'), 2);
    assert.equal(addDays('2028-02-28', 2), '2028-03-01');
  });

  it('前に戻せる', () => {
    assert.equal(addDays('2026-09-01', -3), '2026-08-29');
  });

  /*
   * 夏時間のある地域では、日付をまたぐ計算が 23 時間や 25 時間になる。
   * 正午に置いて数えているので、そこでずれない。
   */
  it('夏時間の切り替わりを越えても日数が狂わない', () => {
    assert.equal(dayIndex('2026-03-30', '2026-03-28'), 2);
    assert.equal(dayIndex('2026-11-02', '2026-10-31'), 2);
  });

  it('月曜が 0 になる', () => {
    // 2026-09-07 は月曜
    assert.equal(weekdayIndex('2026-09-07'), 0);
    assert.equal(weekdayIndex('2026-09-12'), 5);
    assert.equal(weekdayIndex('2026-09-13'), 6);
  });
});

/* --------------------------------------------------------------------------
   行を選ぶ
   -------------------------------------------------------------------------- */

describe('図に出す行を選ぶ', () => {
  it('期間を持たない葉は図に出ない', () => {
    const rows = selectRows([dated('a', '2026-09-01', '2026-09-05'), thread({ id: 'b' })]).rows;
    assert.deepEqual(titles(rows), ['a']);
  });

  it('期間を持たない親は、子のために残る', () => {
    const rows = selectRows([
      thread({ id: 'oya' }),
      dated('ko', '2026-09-01', '2026-09-05', { parentId: 'oya', parentNumber: 1 }),
    ]).rows;
    assert.deepEqual(titles(rows), ['oya', 'ko']);
    assert.equal(rows[0]?.depth, 0);
    assert.equal(rows[1]?.depth, 1);
  });

  it('祖父まで辿って残す', () => {
    const rows = selectRows([
      thread({ id: 'sofu' }),
      thread({ id: 'oya', parentId: 'sofu', parentNumber: 1 }),
      dated('ko', '2026-09-01', '2026-09-05', { parentId: 'oya', parentNumber: 2 }),
    ]).rows;
    assert.deepEqual(titles(rows), ['sofu', 'oya', 'ko']);
    assert.deepEqual(
      rows.map((row) => row.depth),
      [0, 1, 2],
    );
  });

  it('アーカイブ済みは種にならない', () => {
    const rows = selectRows([dated('a', '2026-09-01', '2026-09-05', { archived: true })]).rows;
    assert.deepEqual(titles(rows), []);
  });

  it('アーカイブ済みでも、生きた子の親としては残る', () => {
    const rows = selectRows([
      dated('oya', '2026-09-01', '2026-09-30', { archived: true }),
      dated('ko', '2026-09-02', '2026-09-05', { parentId: 'oya', parentNumber: 1 }),
    ]).rows;
    assert.deepEqual(titles(rows), ['oya', 'ko']);
    assert.equal(rows[0]?.thread.archived, true);
  });

  it('親が図に出ないときは最上位へ上げ、印を立てる', () => {
    // 親が議論のとき、問い合わせは parentId を null にして番号だけ返す
    const rows = selectRows([
      dated('ko', '2026-09-01', '2026-09-05', { parentId: null, parentNumber: 12 }),
    ]).rows;
    assert.equal(rows[0]?.depth, 0);
    assert.equal(rows[0]?.orphaned, true);
  });

  it('親が最初からいない行に、その印は立たない', () => {
    const rows = selectRows([dated('a', '2026-09-01', '2026-09-05')]).rows;
    assert.equal(rows[0]?.orphaned, false);
  });

  it('子孫の数を数える', () => {
    const rows = selectRows([
      thread({ id: 'oya' }),
      dated('ko1', '2026-09-01', '2026-09-05', { parentId: 'oya', parentNumber: 1 }),
      dated('mago', '2026-09-02', '2026-09-03', { parentId: 'ko1', parentNumber: 2 }),
      dated('ko2', '2026-09-06', '2026-09-08', { parentId: 'oya', parentNumber: 1 }),
    ]).rows;
    assert.equal(rows[0]?.descendants, 3);
    assert.equal(rows[1]?.descendants, 1);
    assert.equal(rows[3]?.descendants, 0);
  });
});

describe('同じ階層の並び', () => {
  it('開始日の早い順に並ぶ', () => {
    const rows = selectRows([
      dated('c', '2026-09-10', '2026-09-12'),
      dated('a', '2026-09-01', '2026-09-02'),
      dated('b', '2026-09-05', '2026-09-06'),
    ]).rows;
    assert.deepEqual(titles(rows), ['a', 'b', 'c']);
  });

  it('開始日が同じなら終了日の早い順', () => {
    const rows = selectRows([
      dated('nagai', '2026-09-01', '2026-09-30'),
      dated('mijikai', '2026-09-01', '2026-09-02'),
    ]).rows;
    assert.deepEqual(titles(rows), ['mijikai', 'nagai']);
  });

  it('開始日も終了日も同じなら課題番号の若い順', () => {
    const rows = selectRows([
      dated('ato', '2026-09-01', '2026-09-02', { number: 20 }),
      dated('saki', '2026-09-01', '2026-09-02', { number: 3 }),
    ]).rows;
    assert.deepEqual(titles(rows), ['saki', 'ato']);
  });

  it('期間を持たない行は、その階層の末尾に置く', () => {
    const rows = selectRows([
      thread({ id: 'oya' }),
      thread({ id: 'kikan-nashi', parentId: 'oya', parentNumber: 1 }),
      dated('ko', '2026-09-05', '2026-09-06', { parentId: 'oya', parentNumber: 1 }),
      dated('mago', '2026-09-05', '2026-09-06', {
        parentId: 'kikan-nashi',
        parentNumber: 2,
      }),
    ]).rows;
    assert.deepEqual(titles(rows), ['oya', 'ko', 'kikan-nashi', 'mago']);
  });
});

describe('数を切る', () => {
  it('種の数だけを切る', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      dated(`t${i}`, `2026-09-${String(i + 1).padStart(2, '0')}`, '2026-09-30'),
    );
    const selection = selectRows(many, 4);
    assert.equal(selection.drawn, 4);
    assert.equal(selection.dated, 10);
    assert.deepEqual(titles(selection.rows), ['t0', 't1', 't2', 't3']);
  });

  it('切った先の祖先は、順位に関わらず残る', () => {
    /*
     * 親の開始日が遅く、単純に上から 1 件だけ取ると親が落ちる。
     * 落ちると子のインデントの根拠が消えるので、上限を超えても残す。
     */
    const selection = selectRows(
      [
        dated('osoi-oya', '2026-12-01', '2026-12-31'),
        dated('hayai-ko', '2026-09-01', '2026-09-05', {
          parentId: 'osoi-oya',
          parentNumber: 1,
        }),
      ],
      1,
    );
    assert.equal(selection.drawn, 1);
    assert.equal(selection.rows.length, 2);
    assert.deepEqual(titles(selection.rows), ['osoi-oya', 'hayai-ko']);
  });

  it('輪になっていても、行が消えない', () => {
    /*
     * 親の付け替えで弾いているが、弾き漏れたときに図が丸ごと空になるのは
     * いちばん困る壊れ方である。根が無くても、全部の行が一度ずつ出る。
     */
    const rows = selectRows([
      dated('a', '2026-09-01', '2026-09-05', { parentId: 'b', parentNumber: 2 }),
      dated('b', '2026-09-02', '2026-09-06', { parentId: 'a', parentNumber: 1 }),
    ]).rows;
    assert.equal(rows.length, 2);
    assert.equal(new Set(titles(rows)).size, 2, '同じ行を二度出さない');
  });

  it('輪の外にある行も、巻き込まれて消えない', () => {
    const rows = selectRows([
      dated('mutual-a', '2026-09-01', '2026-09-05', { parentId: 'mutual-b', parentNumber: 2 }),
      dated('mutual-b', '2026-09-02', '2026-09-06', { parentId: 'mutual-a', parentNumber: 1 }),
      dated('hitori', '2026-09-03', '2026-09-04'),
    ]).rows;
    assert.ok(titles(rows).includes('hitori'));
    assert.equal(rows.length, 3);
  });
});

/* --------------------------------------------------------------------------
   はみ出し
   -------------------------------------------------------------------------- */

describe('はみ出しの判定', () => {
  const oya = dated('oya', '2026-09-05', '2026-09-20');

  it('子が親の右へ出ていれば立つ', () => {
    const rows = selectRows([
      oya,
      dated('ko', '2026-09-10', '2026-09-25', { parentId: 'oya', parentNumber: 1 }),
    ]).rows;
    assert.equal(rows[1]?.overflow, true);
    assert.equal(rows[0]?.childOverflow, true);
  });

  it('子が親の左へ出ていても立つ', () => {
    const rows = selectRows([
      oya,
      dated('ko', '2026-09-01', '2026-09-10', { parentId: 'oya', parentNumber: 1 }),
    ]).rows;
    assert.equal(rows[1]?.overflow, true);
  });

  it('端が揃っているだけなら立たない', () => {
    const rows = selectRows([
      oya,
      dated('ko', '2026-09-05', '2026-09-20', { parentId: 'oya', parentNumber: 1 }),
    ]).rows;
    assert.equal(rows[1]?.overflow, false);
    assert.equal(rows[0]?.childOverflow, false);
  });

  it('親に期間が無い組は判定しない', () => {
    const rows = selectRows([
      thread({ id: 'oya' }),
      dated('ko', '2026-09-01', '2026-09-30', { parentId: 'oya', parentNumber: 1 }),
    ]).rows;
    assert.equal(rows[1]?.overflow, false);
    assert.equal(rows[0]?.childOverflow, false);
  });

  it('見るのは直接の親だけである', () => {
    /*
     * 孫は祖父の期間を越えているが、親の期間には収まっている。
     * 祖父に印を出すと、どの段で起きたのかが読めなくなる。
     */
    const rows = selectRows([
      dated('sofu', '2026-09-01', '2026-09-10'),
      dated('oya', '2026-09-01', '2026-09-30', {
        parentId: 'sofu',
        parentNumber: 1,
      }),
      dated('mago', '2026-09-20', '2026-09-25', { parentId: 'oya', parentNumber: 2 }),
    ]).rows;
    assert.equal(rows[0]?.childOverflow, true, '親は祖父から出ている');
    assert.equal(rows[1]?.overflow, true);
    assert.equal(rows[1]?.childOverflow, false, '孫は親に収まっている');
    assert.equal(rows[2]?.overflow, false);
  });
});

/* --------------------------------------------------------------------------
   描く範囲
   -------------------------------------------------------------------------- */

describe('横軸の範囲', () => {
  it('課題の期間から決まり、両端に余白が付く', () => {
    const rows = selectRows([dated('a', '2026-09-10', '2026-09-20')]).rows;
    const range = computeRange(rows, '2026-09-15');
    assert.equal(range.from, '2026-09-07');
    assert.equal(range.to, '2026-09-23');
    assert.equal(range.days, 17);
  });

  it('今日が課題の外にあれば、今日まで伸びる', () => {
    const rows = selectRows([dated('a', '2026-09-10', '2026-09-20')]).rows;
    const range = computeRange(rows, '2026-12-01');
    assert.equal(range.to, '2026-12-04');
    assert.equal(range.todayIndex, dayIndex('2026-12-01', range.from));
  });

  it('今日は必ず範囲の中に入る', () => {
    const rows = selectRows([dated('a', '2026-09-10', '2026-09-20')]).rows;
    for (const today of ['2020-01-01', '2026-09-15', '2099-12-31']) {
      const range = computeRange(rows, today);
      assert.ok(range.todayIndex >= 0 && range.todayIndex < range.days, today);
    }
  });

  it('切って落ちた課題は範囲を広げない', () => {
    /*
     * 描かないものに合わせて幅を取ると、誰のものでもない空白が端にできる。
     * 遠い課題は種の並びで後ろに来るので、切られたぶんは範囲に効かない。
     */
    const selection = selectRows(
      [dated('chikai', '2026-09-01', '2026-09-05'), dated('tooi', '2027-06-01', '2027-06-30')],
      1,
    );
    const range = computeRange(selection.rows, '2026-09-03');
    assert.equal(range.to, '2026-09-08');
  });

  it('土日の縞をずらす日数が、範囲の初日の曜日になる', () => {
    /*
     * 曜日ごとに確かめる。月曜始まりの範囲だけで見ると、
     * ずらす日数を 0 に固定しても気づけない。
     */
    for (let i = 0; i < 7; i += 1) {
      const start = addDays('2026-09-10', i);
      const range = computeRange(selectRows([dated('a', start, start)]).rows, start);
      assert.equal(range.weekOffset, weekdayIndex(range.from), start);
    }
    // 少なくとも一つは 0 以外になる（0 固定なら上の輪で落ちる）
    const range = computeRange(
      selectRows([dated('a', '2026-09-11', '2026-09-11')]).rows,
      '2026-09-11',
    );
    assert.notEqual(range.weekOffset, 0);
  });
});

describe('年月の帯', () => {
  it('月ごとに切って日数を返す', () => {
    const range = computeRange(
      selectRows([dated('a', '2026-09-28', '2026-10-02')]).rows,
      '2026-09-29',
    );
    const bands = monthBands(range);
    assert.deepEqual(
      bands.map((band) => band.label),
      ['2026年9月', '2026年10月'],
    );
    assert.equal(
      bands.reduce((sum, band) => sum + band.days, 0),
      range.days,
    );
  });

  it('年をまたぐ', () => {
    const range = computeRange(
      selectRows([dated('a', '2026-12-30', '2027-01-02')]).rows,
      '2026-12-31',
    );
    assert.deepEqual(
      monthBands(range).map((band) => band.label),
      ['2026年12月', '2027年1月'],
    );
  });
});

describe('バーの置き場所', () => {
  const range = computeRange(
    selectRows([dated('a', '2026-09-10', '2026-09-20')]).rows,
    '2026-09-15',
  );

  it('左端からの日数と、日数ぶんの長さになる', () => {
    const bar = placeBar(dated('a', '2026-09-10', '2026-09-12'), range);
    assert.deepEqual(bar, { offset: 3, length: 3 });
  });

  it('一日だけの課題も長さ 1 になる', () => {
    const bar = placeBar(dated('a', '2026-09-10', '2026-09-10'), range);
    assert.equal(bar?.length, 1);
  });

  it('期間が無ければ置かない', () => {
    assert.equal(placeBar(thread({ id: 'a' }), range), null);
  });

  it('範囲の外へ出る部分は切り詰める', () => {
    const bar = placeBar(dated('a', '2026-01-01', '2026-09-08'), range);
    assert.deepEqual(bar, { offset: 0, length: 2 });
  });

  it('範囲とまったく重ならなければ置かない', () => {
    assert.equal(placeBar(dated('a', '2025-01-01', '2025-01-05'), range), null);
  });
});

/* --------------------------------------------------------------------------
   引くところ
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

describe('図に出しうる課題を引く', () => {
  it('引くのは課題だけである', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const project = await newProject(org, scope.userId);
    await addThread(org, project.id, scope.userId, 'kadai', {
      starts_on: '2026-09-01',
      ends_on: '2026-09-05',
    });
    await addThread(org, project.id, scope.userId, 'giron');
    await addThread(org, project.id, scope.userId, 'shitsumon');

    const rows = await listGanttThreads(scope, project.id);
    assert.equal(rows.length, 1);
  });

  it('親が議論なら、木としてはつながず番号だけ返す', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const project = await newProject(org, scope.userId);
    const giron = await addThread(org, project.id, scope.userId, 'giron');
    await addThread(org, project.id, scope.userId, 'kadai', {
      starts_on: '2026-09-01',
      ends_on: '2026-09-05',
      parent_thread_id: giron.id,
    });

    const rows = await listGanttThreads(scope, project.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.parentId, null, '議論は親として辿らない');
    assert.equal(rows[0]?.parentNumber, giron.number, '番号は出す');

    // 図の側では最上位に上がり、外れて見える理由の印が立つ
    assert.equal(selectRows(rows).rows[0]?.orphaned, true);
  });

  it('親が消えていれば、番号も出さない', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const project = await newProject(org, scope.userId);
    const oya = await addThread(org, project.id, scope.userId, 'kadai', {
      archived_at: new Date(),
      deleted_at: new Date(),
    });
    await addThread(org, project.id, scope.userId, 'kadai', {
      starts_on: '2026-09-01',
      ends_on: '2026-09-05',
      parent_thread_id: oya.id,
    });

    const rows = await listGanttThreads(scope, project.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.parentId, null);
    assert.equal(rows[0]?.parentNumber, null);
    assert.equal(selectRows(rows).rows[0]?.orphaned, false);
  });

  it('アーカイブ済みの親も、生きた子の親としては引かれる', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const project = await newProject(org, scope.userId);
    const oya = await addThread(org, project.id, scope.userId, 'kadai', {
      starts_on: '2026-09-01',
      ends_on: '2026-09-30',
      archived_at: new Date(),
    });
    await addThread(org, project.id, scope.userId, 'kadai', {
      starts_on: '2026-09-02',
      ends_on: '2026-09-05',
      parent_thread_id: oya.id,
    });

    const rows = await listGanttThreads(scope, project.id);
    assert.equal(rows.length, 2);
    assert.equal(rows.filter((row) => row.archived).length, 1);
  });

  it('アーカイブ済みだけなら、何も引かない', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const project = await newProject(org, scope.userId);
    await addThread(org, project.id, scope.userId, 'kadai', {
      starts_on: '2026-09-01',
      ends_on: '2026-09-30',
      archived_at: new Date(),
    });
    assert.equal((await listGanttThreads(scope, project.id)).length, 0);
  });

  it('他のプロジェクトの課題は混ざらない', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const here = await newProject(org, scope.userId);
    const there = await newProject(org, scope.userId);
    await addThread(org, here.id, scope.userId, 'kadai', {
      starts_on: '2026-09-01',
      ends_on: '2026-09-05',
    });
    await addThread(org, there.id, scope.userId, 'kadai', {
      starts_on: '2026-09-01',
      ends_on: '2026-09-05',
    });

    assert.equal((await listGanttThreads(scope, here.id)).length, 1);
  });

  it('見えない非公開プロジェクトからは引けない', async () => {
    const org = await newOrg();
    const owner = await member(org);
    const outsider = await member(org, 'member');
    const project = await newProject(org, owner.userId, 'private');
    await addThread(org, project.id, owner.userId, 'kadai', {
      starts_on: '2026-09-01',
      ends_on: '2026-09-05',
    });

    assert.equal((await listGanttThreads(outsider, project.id)).length, 0);
    assert.equal((await listUndated(outsider, project.id)).length, 0);
    assert.equal((await countThreads(outsider, project.id)).total, 0);
  });

  it('偽ったスコープでは越えられない', async () => {
    const org = await newOrg();
    const owner = await member(org);
    const outsider = await member(org, 'member');
    const project = await newProject(org, owner.userId, 'private');
    await addThread(org, project.id, owner.userId, 'kadai', {
      starts_on: '2026-09-01',
      ends_on: '2026-09-05',
    });

    // 組織管理者を騙っても、閲覧の判定は SQL の側にある
    const faked = { ...outsider, isOrgAdmin: true };
    assert.equal((await listGanttThreads(faked, project.id)).length, 0);
  });

  it('上限は種の側にかかり、祖先はそのまま引かれる', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const project = await newProject(org, scope.userId);
    const oya = await addThread(org, project.id, scope.userId, 'kadai', {
      starts_on: '2026-12-01',
      ends_on: '2026-12-31',
    });
    await addThread(org, project.id, scope.userId, 'kadai', {
      starts_on: '2026-09-01',
      ends_on: '2026-09-05',
      parent_thread_id: oya.id,
    });

    const rows = await listGanttThreads(scope, project.id, 1);
    assert.equal(rows.length, 2, '種は1件でも、その親は引く');
  });

  it('上限を超えた種は引かない', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const project = await newProject(org, scope.userId);
    for (let i = 1; i <= 4; i += 1) {
      await addThread(org, project.id, scope.userId, 'kadai', {
        starts_on: `2026-09-0${i}`,
        ends_on: `2026-09-0${i}`,
      });
    }

    assert.equal((await listGanttThreads(scope, project.id, 2)).length, 2);
    assert.equal((await listGanttThreads(scope, project.id)).length, 4);
  });
});

describe('期間未設定の枠', () => {
  it('終わっておらず、畳まれておらず、期間の無い課題だけが並ぶ', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const project = await newProject(org, scope.userId);
    const nokoru = await addThread(org, project.id, scope.userId, 'kadai');
    await addThread(org, project.id, scope.userId, 'kadai', { progress: 100 });
    await addThread(org, project.id, scope.userId, 'kadai', { archived_at: new Date() });
    await addThread(org, project.id, scope.userId, 'kadai', {
      starts_on: '2026-09-01',
      ends_on: '2026-09-05',
    });
    await addThread(org, project.id, scope.userId, 'giron');

    const rows = await listUndated(scope, project.id);
    assert.deepEqual(
      rows.map((row) => row.number),
      [nokoru.number],
    );
  });

  it('課題番号の若い順に並ぶ', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const project = await newProject(org, scope.userId);
    const first = await addThread(org, project.id, scope.userId, 'kadai');
    const second = await addThread(org, project.id, scope.userId, 'kadai');
    const third = await addThread(org, project.id, scope.userId, 'kadai');

    const rows = await listUndated(scope, project.id);
    assert.deepEqual(
      rows.map((row) => row.number),
      [first.number, second.number, third.number],
    );
  });

  it('上限で切れる', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const project = await newProject(org, scope.userId);
    for (let i = 0; i < 4; i += 1) {
      await addThread(org, project.id, scope.userId, 'kadai');
    }
    assert.equal((await listUndated(scope, project.id, 2)).length, 2);
    assert.equal((await countThreads(scope, project.id)).undated, 4, '数は切らずに数える');
  });
});

describe('件数', () => {
  it('分母は畳まれていない課題で、終わったものも含む', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const project = await newProject(org, scope.userId);
    await addThread(org, project.id, scope.userId, 'kadai', {
      starts_on: '2026-09-01',
      ends_on: '2026-09-05',
    });
    await addThread(org, project.id, scope.userId, 'kadai', {
      progress: 100,
      starts_on: '2026-09-01',
      ends_on: '2026-09-05',
    });
    await addThread(org, project.id, scope.userId, 'kadai');
    await addThread(org, project.id, scope.userId, 'kadai', { archived_at: new Date() });
    await addThread(org, project.id, scope.userId, 'giron');

    const counts = await countThreads(scope, project.id);
    assert.equal(counts.total, 3, '畳んだものと議論は数えない');
    assert.equal(counts.dated, 2);
    assert.equal(counts.undated, 1);
  });

  it('終わっていて期間の無い課題は、分母には入るが別枠には出ない', async () => {
    const org = await newOrg();
    const scope = await member(org);
    const project = await newProject(org, scope.userId);
    await addThread(org, project.id, scope.userId, 'kadai', { progress: 100 });

    const counts = await countThreads(scope, project.id);
    assert.equal(counts.total, 1);
    assert.equal(counts.dated, 0);
    assert.equal(counts.undated, 0);
  });
});
