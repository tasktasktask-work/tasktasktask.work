import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import sharp from 'sharp';
import { reencode, withExtension } from '#features/attachment/image.ts';
import { cleanName, describeProblem, readIncoming } from '#features/attachment/incoming.ts';
import { BATCH_MAX, FILE_FIELD, FILE_MAX } from '#features/attachment/limits.ts';
import {
  attachToThread,
  deleteAttachment,
  findDeliverable,
  listCommentAttachments,
  listThreadAttachments,
  organizationUsage,
} from '#features/attachment/queries.ts';
import { read } from '#features/attachment/storage.ts';
import { prepareAttachments } from '#features/attachment/store.ts';
import { postComment } from '#features/comment/queries.ts';
import type { MemberRole } from '#features/organization/queries.ts';
import { createThread } from '#features/thread/queries.ts';
import { type OrgScope, pool } from '#lib/db.ts';

/*
 * 置き場は最初に触られたときに決まる（env は遅延して読む）。
 * テストの本体が走る前にここで差し替えれば、実物のディレクトリは汚れない。
 */
const sandbox = await mkdtemp(join(tmpdir(), 'task3-attach-'));
process.env.ATTACHMENTS_DIR = sandbox;

/*
 * 添付ファイル。
 *
 * 形式を検査しないと決めた以上、確かめるべきものは三つある。
 * 読めた画像だけが作り直されて is_image が真になること、
 * 組織と非公開プロジェクトの境界を添付が越えないこと、
 * そして「消したら実体も消える」が本当にそのとおり動くことである。
 */

const TAG = `att-${process.pid}`;
let seq = 0;
const uniq = (): string => {
  seq += 1;
  return `${TAG}-${seq}`;
};

let keySeq = 0;
const newKey = (): string => {
  keySeq += 1;
  return `A${keySeq}`;
};

after(async () => {
  const like = `${TAG}-%`;
  const inOrg = `organization_id IN (SELECT id FROM organizations WHERE slug LIKE $1)`;
  await pool.query(`DELETE FROM attachments WHERE ${inOrg}`, [like]);
  await pool.query(
    `DELETE FROM comment_mentions WHERE comment_id IN (
       SELECT id FROM comments WHERE ${inOrg})`,
    [like],
  );
  await pool.query(`DELETE FROM notifications WHERE ${inOrg}`, [like]);
  await pool.query(`DELETE FROM comments WHERE ${inOrg}`, [like]);
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
  await rm(sandbox, { recursive: true, force: true });
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

async function newThread(scope: OrgScope, projectId: string): Promise<string> {
  const made = await createThread(scope, projectId, {
    type: 'kadai',
    title: '検索APIの実装',
    parentNumber: null,
  });
  if (!made.ok) {
    throw new Error('立てられませんでした');
  }
  return value('SELECT id FROM threads WHERE organization_id = $1 AND number = $2', [
    scope.organizationId,
    made.number,
  ]);
}

/** 透明を持つ画像。作り直すと PNG になる */
const transparent = async (): Promise<Buffer> =>
  sharp({
    create: {
      width: 8,
      height: 8,
      channels: 4,
      background: { r: 200, g: 60, b: 44, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();

/** 透明を持たない画像。作り直すと JPEG になる */
const opaque = async (): Promise<Buffer> =>
  sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 44, g: 74, b: 117 } },
  })
    .jpeg()
    .toBuffer();

const notAnImage = (): Buffer => Buffer.from('これは画像ではありません', 'utf8');

async function put(
  scope: OrgScope,
  threadId: string,
  files: { filename: string; bytes: Buffer; declaredType?: string }[],
) {
  const prepared = await prepareAttachments(
    scope.organizationId,
    files.map((f) => ({
      filename: f.filename,
      declaredType: f.declaredType ?? null,
      bytes: f.bytes,
    })),
  );
  assert.equal(prepared.ok, true);
  if (!prepared.ok) {
    throw new Error('作り直せませんでした');
  }
  return attachToThread(scope, threadId, prepared.prepared);
}

/* --------------------------------------------------------------------------
   名前
   -------------------------------------------------------------------------- */

describe('名前の始末', () => {
  it('区切りより後ろだけを使う', () => {
    assert.equal(cleanName('../../etc/passwd'), 'passwd');
    assert.equal(cleanName('C:\\temp\\shot.png'), 'shot.png');
  });

  it('拡張子を偽装する制御文字を落とす', () => {
    // 画面上で report.exe.jpg に見える名前
    assert.equal(cleanName('report\u202Egpj.exe'), 'reportgpj.exe');
  });

  it('制御文字を落とす。ヘッダにも画面にも出る値である', () => {
    assert.equal(cleanName('a\u0000b\nc.txt'), 'abc.txt');
  });

  it('名前が残らないものは断る', () => {
    assert.equal(cleanName('..'), null);
    assert.equal(cleanName('   '), null);
    assert.equal(cleanName('/'), null);
  });

  it('長すぎる名前は切り詰める。拡張子は残す', () => {
    const name = `${'あ'.repeat(400)}.png`;
    const cleaned = cleanName(name);
    assert.ok(cleaned);
    assert.equal(cleaned.length, 255);
    assert.ok(cleaned.endsWith('.png'));
  });

  it('拡張子を出力に合わせる。名前の本体は触らない', () => {
    assert.equal(withExtension('shot.gif', 'png'), 'shot.png');
    assert.equal(withExtension('画面 の 写し.HEIC', 'jpg'), '画面 の 写し.jpg');
    assert.equal(withExtension('拡張子なし', 'png'), '拡張子なし.png');
  });
});

/* --------------------------------------------------------------------------
   作り直し
   -------------------------------------------------------------------------- */

describe('画像を作り直す', () => {
  it('透明を持つものは PNG になる', async () => {
    const out = await reencode(await transparent());
    assert.ok(out);
    assert.equal(out.extension, 'png');
  });

  it('透明を持たないものは JPEG になる', async () => {
    const out = await reencode(await opaque());
    assert.ok(out);
    assert.equal(out.extension, 'jpg');
  });

  it('読めなかったものは画像として扱わない', async () => {
    assert.equal(await reencode(notAnImage()), null);
    assert.equal(await reencode(Buffer.alloc(0)), null);
  });

  it('先頭だけ画像に見せかけたファイルも通らない', async () => {
    // GIF89a で始まり、後ろに HTML が続く。マジックバイト判定は通過する形である
    const polyglot = Buffer.concat([
      Buffer.from('GIF89a'),
      Buffer.from('<script>alert(1)</script>'),
    ]);
    assert.equal(await reencode(polyglot), null);
  });

  it('スクリプトを埋めた SVG は、ラスタの画像になる', async () => {
    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8">
         <script>alert(1)</script><rect width="8" height="8" fill="red"/></svg>`,
    );
    const out = await reencode(svg);
    assert.ok(out, 'SVG は読めるはず');
    assert.ok(!out.bytes.includes(Buffer.from('script')), '出力にスクリプトが残っている');
  });

  it('作り直すと上限を超えるものは断る', async () => {
    /*
     * 透明を持つ画像は PNG で書き出す。
     * 元が非可逆な形式だと、作り直した結果が元より大きくなりうる。
     * 原本を代わりに置く手もあるが、それをやると
     * 「作り直した出力だけを保存する」約束が、大きい画像のときだけ黙って外れる。
     */
    const side = 3000;
    const noise = Buffer.alloc(side * side * 4);
    for (let i = 0; i < noise.length; i++) {
      noise[i] = (Math.random() * 256) | 0;
    }
    const input = await sharp(noise, { raw: { width: side, height: side, channels: 4 } })
      .webp({ quality: 1, alphaQuality: 1 })
      .toBuffer();

    assert.ok(input.byteLength < FILE_MAX, '入る大きさで届く');

    const result = await prepareAttachments(crypto.randomUUID(), [
      { filename: 'noise.webp', declaredType: 'image/webp', bytes: input },
    ]);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'reencoded-too-large');
      assert.equal(result.filename, 'noise.webp');
    }
  });

  it('メタデータは残らない', async () => {
    const withExif = await sharp({
      create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .withExif({ IFD0: { Copyright: 'TASK3', Software: 'somewhere' } })
      .jpeg()
      .toBuffer();

    const out = await reencode(withExif);
    assert.ok(out);
    const meta = await sharp(out.bytes).metadata();
    assert.equal(meta.exif, undefined);
  });
});

/* --------------------------------------------------------------------------
   受け取る
   -------------------------------------------------------------------------- */

describe('受け取る前に断る', () => {
  const form = (files: File[]): FormData => {
    const data = new FormData();
    for (const file of files) {
      data.append('files', file);
    }
    return data;
  };

  it('1ファイルの上限を超えたものを断る', async () => {
    const big = new File([new Uint8Array(FILE_MAX + 1)], 'big.bin');
    const result = await readIncoming(form([big]));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'too-large');
    }
  });

  it('合計の上限を超えたものを断る', async () => {
    const each = new Uint8Array(FILE_MAX);
    const many = Array.from(
      { length: Math.ceil(BATCH_MAX / FILE_MAX) + 1 },
      (_, i) => new File([each], `part${i}.bin`),
    );
    const result = await readIncoming(form(many));
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'batch-too-large');
    }
  });

  /*
   * 何も選ばずに投稿しても、ファイルの欄は送られてくる。
   * 届く形は一つではない。ここを断ると、添付を付けないコメントが
   * 一つも投稿できなくなる（2026-09-08 に本番で踏んだ）。
   */
  it('何も選んでいない欄は、そのまま通す', async () => {
    const shapes: [string, File][] = [
      ['名前の無い File', new File([], '', { type: 'application/octet-stream' })],
      ['名前の無い File（種別も無い）', new File([], '')],
      ['中身の無い File（名前はある）', new File([], 'empty.txt')],
    ];
    for (const [label, file] of shapes) {
      const result = await readIncoming(form([file]));
      assert.equal(result.ok, true, label);
      if (result.ok) {
        assert.equal(result.files.length, 0, label);
      }
    }
  });

  it('名前を失って blob になった欄も、そのまま通す', async () => {
    /*
     * Blob を FormData に入れると、仕様どおり blob という名前が付く。
     * 符号化の途中で File が Blob になると、この形で届く。
     */
    const data = new FormData();
    data.append(FILE_FIELD, new Blob([]));
    const entry = data.getAll(FILE_FIELD)[0] as File;
    assert.equal(entry.name, 'blob', '前提が変わっている');
    assert.equal(entry.size, 0);

    const result = await readIncoming(data);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.files.length, 0);
    }
  });

  it('中身のあるファイルは、空の欄と一緒に来ても拾う', async () => {
    const data = new FormData();
    data.append(FILE_FIELD, new Blob([]));
    data.append(FILE_FIELD, new File([Buffer.from('こんにちは')], 'memo.txt'));

    const result = await readIncoming(data);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(
        result.files.map((f) => f.filename),
        ['memo.txt'],
      );
    }
  });

  it('断る理由は、どの経路から来ても同じ文になる', () => {
    assert.match(describeProblem('too-large', 'big.png'), /big\.png/);
    assert.match(describeProblem('reencoded-too-large', 'big.png'), /作り直す/);
  });
});

/* --------------------------------------------------------------------------
   付ける
   -------------------------------------------------------------------------- */

describe('スレッドに付ける', () => {
  it('付けたものが出る。読めた画像は is_image が真になる', async () => {
    const org = await newOrg();
    const asuka = await member(org);
    const project = await newProject(org, asuka.userId);
    const thread = await newThread(asuka, project.id);

    const result = await put(asuka, thread, [
      { filename: 'shot.png', bytes: await transparent(), declaredType: 'image/png' },
      { filename: '仕様.txt', bytes: notAnImage(), declaredType: 'text/plain' },
    ]);
    assert.equal(result.ok, true);

    const list = await listThreadAttachments(asuka, thread);
    assert.equal(list.length, 2);
    assert.deepEqual(
      list.map((a) => [a.filename, a.isImage]),
      [
        ['shot.png', true],
        ['仕様.txt', false],
      ],
      '付けた順に並ぶ',
    );
  });

  it('一度の送信で入れても、選んだ順に並ぶ', async () => {
    const org = await newOrg();
    const asuka = await member(org);
    const project = await newProject(org, asuka.userId);
    const thread = await newThread(asuka, project.id);

    const names = ['一.txt', '二.txt', '三.txt', '四.txt'];
    await put(
      asuka,
      thread,
      names.map((filename) => ({ filename, bytes: notAnImage() })),
    );

    assert.deepEqual(
      (await listThreadAttachments(asuka, thread)).map((a) => a.filename),
      names,
    );

    /*
     * 並びが偶然そろっただけでないことを確かめる。
     * 既定の now() は取引の開始時刻を返すので、四行とも同じ時刻になり、
     * 並びは第二の鍵（ランダムな id）で決まってしまう。
     */
    const distinct = await value<string>(
      'SELECT count(DISTINCT created_at)::text FROM attachments WHERE thread_id = $1',
      [thread],
    );
    assert.equal(distinct, '4', '行ごとに時刻が違う');
  });

  it('画像の名前は、書き出した形式に合わせて付け替わる', async () => {
    const org = await newOrg();
    const asuka = await member(org);
    const project = await newProject(org, asuka.userId);
    const thread = await newThread(asuka, project.id);

    // 中身は PNG だが、名前は gif で届く
    await put(asuka, thread, [{ filename: 'shot.gif', bytes: await transparent() }]);
    const [file] = await listThreadAttachments(asuka, thread);
    assert.equal(file?.filename, 'shot.png');
  });

  it('画像でないものの名前は一切触らない', async () => {
    const org = await newOrg();
    const asuka = await member(org);
    const project = await newProject(org, asuka.userId);
    const thread = await newThread(asuka, project.id);

    await put(asuka, thread, [{ filename: 'archive.zip', bytes: notAnImage() }]);
    const [file] = await listThreadAttachments(asuka, thread);
    assert.equal(file?.filename, 'archive.zip');
  });

  it('実体が置き場に書かれている', async () => {
    const org = await newOrg();
    const asuka = await member(org);
    const project = await newProject(org, asuka.userId);
    const thread = await newThread(asuka, project.id);

    await put(asuka, thread, [{ filename: 'shot.png', bytes: await transparent() }]);
    const key = await value<string>(
      'SELECT storage_key FROM attachments WHERE thread_id = $1',
      [thread],
    );

    assert.ok(key.startsWith(`${org.id}/`), '組織で一段掘る');
    assert.ok(key.endsWith('.png'), '拡張子は配信の Content-Type を決める');
    assert.ok(!key.includes('shot'), '利用者の入力はキーに入らない');

    const bytes = await read(key);
    assert.ok(bytes.byteLength > 0);
  });

  it('置き場の外を指すキーは読めない', async () => {
    await assert.rejects(() => read('../../etc/passwd'), /置き場の外/);
  });

  it('畳んだスレッドには付けられない', async () => {
    const org = await newOrg();
    const asuka = await member(org);
    const project = await newProject(org, asuka.userId);
    const thread = await newThread(asuka, project.id);
    await pool.query('UPDATE threads SET archived_at = now() WHERE id = $1', [thread]);

    const result = await put(asuka, thread, [
      { filename: 'shot.png', bytes: await transparent() },
    ]);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'archived');
    }
  });

  it('見えないプロジェクトのスレッドには付けられない', async () => {
    const org = await newOrg();
    const asuka = await member(org);
    const outsider = await member(org, 'member');
    const project = await newProject(org, asuka.userId, 'private');
    const thread = await newThread(asuka, project.id);

    const result = await put(outsider, thread, [
      { filename: 'shot.png', bytes: await transparent() },
    ]);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'not-found');
    }
  });

  it('別の組織のスレッドには付けられない', async () => {
    const home = await newOrg();
    const asuka = await member(home);
    const project = await newProject(home, asuka.userId);
    const thread = await newThread(asuka, project.id);

    const other = await newOrg();
    const stranger = await member(other);

    const result = await put(stranger, thread, [
      { filename: 'shot.png', bytes: await transparent() },
    ]);
    assert.equal(result.ok, false);
  });
});

/* --------------------------------------------------------------------------
   コメント
   -------------------------------------------------------------------------- */

describe('コメントに付ける', () => {
  it('本文と同じ投稿で付く', async () => {
    const org = await newOrg();
    const asuka = await member(org);
    const project = await newProject(org, asuka.userId);
    const thread = await newThread(asuka, project.id);

    const prepared = await prepareAttachments(org.id, [
      { filename: 'shot.png', declaredType: 'image/png', bytes: await transparent() },
    ]);
    assert.equal(prepared.ok, true);
    if (!prepared.ok) {
      throw new Error('作り直せませんでした');
    }

    const posted = await postComment(asuka, thread, '画面の写しです', prepared.prepared);
    assert.equal(posted.ok, true);
    if (!posted.ok) {
      throw new Error('投稿できませんでした');
    }

    const grouped = await listCommentAttachments(asuka, thread);
    assert.equal(grouped.get(posted.id)?.length, 1);
    assert.equal(grouped.get(posted.id)?.[0]?.filename, 'shot.png');
  });

  it('コメントが弾かれれば、添付も残らない', async () => {
    const org = await newOrg();
    const asuka = await member(org);
    const project = await newProject(org, asuka.userId);
    const thread = await newThread(asuka, project.id);
    await pool.query('UPDATE threads SET archived_at = now() WHERE id = $1', [thread]);

    const prepared = await prepareAttachments(org.id, [
      { filename: 'shot.png', declaredType: null, bytes: await transparent() },
    ]);
    if (!prepared.ok) {
      throw new Error('作り直せませんでした');
    }

    const posted = await postComment(asuka, thread, '書けないはず', prepared.prepared);
    assert.equal(posted.ok, false);

    const count = await value<string>(
      'SELECT count(*) FROM attachments WHERE organization_id = $1',
      [org.id],
    );
    assert.equal(count, '0', '取引ごと巻き戻る');
  });

  it('消されたコメントの添付は届かない', async () => {
    const org = await newOrg();
    const asuka = await member(org);
    const project = await newProject(org, asuka.userId);
    const thread = await newThread(asuka, project.id);

    const prepared = await prepareAttachments(org.id, [
      { filename: 'shot.png', declaredType: null, bytes: await transparent() },
    ]);
    if (!prepared.ok) {
      throw new Error('作り直せませんでした');
    }
    const posted = await postComment(asuka, thread, '写しです', prepared.prepared);
    if (!posted.ok) {
      throw new Error('投稿できませんでした');
    }

    const id = await value<string>('SELECT id FROM attachments WHERE comment_id = $1', [
      posted.id,
    ]);
    assert.ok(await findDeliverable(asuka, id), '消す前は届く');

    await pool.query('UPDATE comments SET deleted_at = now() WHERE id = $1', [posted.id]);
    assert.equal(await findDeliverable(asuka, id), null, 'コメントごと見えなくなる');
  });
});

/* --------------------------------------------------------------------------
   配信
   -------------------------------------------------------------------------- */

describe('配信のために引く', () => {
  async function fixture() {
    const org = await newOrg();
    const asuka = await member(org);
    const project = await newProject(org, asuka.userId, 'private');
    const thread = await newThread(asuka, project.id);
    await put(asuka, thread, [{ filename: 'shot.png', bytes: await transparent() }]);
    const id = await value<string>('SELECT id FROM attachments WHERE thread_id = $1', [thread]);
    return { org, asuka, thread, id };
  }

  it('見える人には返る', async () => {
    const { asuka, id } = await fixture();
    const found = await findDeliverable(asuka, id);
    assert.equal(found?.filename, 'shot.png');
    assert.equal(found?.isImage, true);
  });

  it('非公開プロジェクトの外の人には返らない', async () => {
    const { org, id } = await fixture();
    const outsider = await member(org, 'member');
    assert.equal(await findDeliverable(outsider, id), null);
  });

  it('別の組織からは返らない', async () => {
    const { id } = await fixture();
    const other = await newOrg();
    const stranger = await member(other);
    assert.equal(await findDeliverable(stranger, id), null);
  });

  it('消されたスレッドの添付は返らない', async () => {
    const { asuka, thread, id } = await fixture();
    await pool.query(
      'UPDATE threads SET archived_at = now(), deleted_at = now() WHERE id = $1',
      [thread],
    );
    assert.equal(await findDeliverable(asuka, id), null);
  });
});

/* --------------------------------------------------------------------------
   消す
   -------------------------------------------------------------------------- */

describe('消す', () => {
  async function fixture() {
    const org = await newOrg();
    const asuka = await member(org);
    const ryo = await member(org, 'member');
    const project = await newProject(org, asuka.userId);
    const thread = await newThread(asuka, project.id);
    // 上げるのは ryo。asuka は組織管理者である
    await put(ryo, thread, [{ filename: 'shot.png', bytes: await transparent() }]);
    const row = await pool.query<{ id: string; storageKey: string }>(
      'SELECT id, storage_key AS "storageKey" FROM attachments WHERE thread_id = $1',
      [thread],
    );
    const found = row.rows[0];
    if (!found) {
      throw new Error('添付がありません');
    }
    return { org, asuka, ryo, thread, ...found };
  }

  it('上げた本人が消せる。実体も消える', async () => {
    const { ryo, id, storageKey, thread } = await fixture();
    const before = await stat(join(sandbox, storageKey));
    assert.ok(before.isFile());

    assert.deepEqual(await deleteAttachment(ryo, id), { ok: true });
    assert.equal((await listThreadAttachments(ryo, thread)).length, 0);
    await assert.rejects(() => read(storageKey), /ENOENT/);
  });

  it('行は残る。誰がいつ消したかが分かる', async () => {
    const { ryo, id } = await fixture();
    await deleteAttachment(ryo, id);

    const row = await pool.query<{ deletedBy: string; filename: string }>(
      `SELECT deleted_by_user_id AS "deletedBy", original_filename AS filename
         FROM attachments WHERE id = $1`,
      [id],
    );
    assert.equal(row.rows[0]?.deletedBy, ryo.userId);
    assert.equal(row.rows[0]?.filename, 'shot.png');
  });

  it('組織管理者は、他人の上げたものを消せる', async () => {
    const { asuka, ryo, id } = await fixture();
    assert.notEqual(asuka.userId, ryo.userId);
    assert.deepEqual(await deleteAttachment(asuka, id), { ok: true });
  });

  it('上げていない人は消せない', async () => {
    const { org, id, storageKey } = await fixture();
    const other = await member(org, 'member');

    const result = await deleteAttachment(other, id);
    assert.equal(result.ok, false);
    assert.ok(await read(storageKey), '実体は残る');
  });

  it('畳んだスレッドでは消せない', async () => {
    const { ryo, id, thread, storageKey } = await fixture();
    await pool.query('UPDATE threads SET archived_at = now() WHERE id = $1', [thread]);

    const result = await deleteAttachment(ryo, id);
    assert.equal(result.ok, false);
    assert.ok(await read(storageKey), '実体は残る');
  });

  it('二度消しても、二度目は何も起きない', async () => {
    const { ryo, id } = await fixture();
    assert.deepEqual(await deleteAttachment(ryo, id), { ok: true });
    const again = await deleteAttachment(ryo, id);
    assert.equal(again.ok, false);
  });
});

/* --------------------------------------------------------------------------
   容量
   -------------------------------------------------------------------------- */

describe('組織の容量', () => {
  it('組織管理者だけが見られる', async () => {
    const org = await newOrg();
    const asuka = await member(org);
    const ryo = await member(org, 'member');
    assert.ok(await organizationUsage(asuka));
    assert.equal(await organizationUsage(ryo), null);
  });

  it('見えないプロジェクトのぶんも数える', async () => {
    const org = await newOrg();
    const asuka = await member(org);
    const secret = await newProject(org, asuka.userId, 'private');
    const thread = await newThread(asuka, secret.id);
    await put(asuka, thread, [{ filename: '仕様.txt', bytes: notAnImage() }]);

    const admin = await member(org);
    const usage = await organizationUsage(admin);
    assert.equal(usage?.count, 1, '数字は「消えたら何が失われるか」を伝えるためのもの');
    assert.ok((usage?.bytes ?? 0) > 0);
  });

  it('消したぶんは数えない', async () => {
    const org = await newOrg();
    const asuka = await member(org);
    const project = await newProject(org, asuka.userId);
    const thread = await newThread(asuka, project.id);
    await put(asuka, thread, [{ filename: '仕様.txt', bytes: notAnImage() }]);

    const id = await value<string>('SELECT id FROM attachments WHERE thread_id = $1', [thread]);
    await deleteAttachment(asuka, id);

    const usage = await organizationUsage(asuka);
    assert.equal(usage?.count, 0);
    assert.equal(usage?.bytes, 0);
  });

  it('別の組織のぶんは混ざらない', async () => {
    const org = await newOrg();
    const asuka = await member(org);
    const project = await newProject(org, asuka.userId);
    const thread = await newThread(asuka, project.id);
    await put(asuka, thread, [{ filename: '仕様.txt', bytes: notAnImage() }]);

    const other = await newOrg();
    const stranger = await member(other);
    assert.equal((await organizationUsage(stranger))?.count, 0);
  });
});

/* --------------------------------------------------------------------------
   スキーマ
   -------------------------------------------------------------------------- */

describe('スキーマが止めるもの', () => {
  let org: Org;
  let asuka: OrgScope;
  let thread: string;

  before(async () => {
    org = await newOrg();
    asuka = await member(org);
    const project = await newProject(org, asuka.userId);
    thread = await newThread(asuka, project.id);
  });

  const insert = (extra: Record<string, unknown>) => {
    const base: Record<string, unknown> = {
      organization_id: org.id,
      thread_id: thread,
      storage_key: `${org.id}/aa/${uniq()}`,
      original_filename: 'shot.png',
      byte_size: 10,
      uploaded_by_user_id: asuka.userId,
      ...extra,
    };
    const cols = Object.keys(base);
    const vals = Object.values(base);
    return pool.query(
      `INSERT INTO attachments (${cols.join(',')})
       VALUES (${vals.map((_, i) => `$${i + 1}`).join(',')})`,
      vals,
    );
  };

  it('スレッドとコメントの両方に付いた行は作れない', async () => {
    await assert.rejects(
      () => insert({ comment_id: thread }),
      /attachments_exactly_one_owner|violates foreign key/,
    );
  });

  it('上限を超える大きさの行は作れない', async () => {
    await assert.rejects(
      () => insert({ byte_size: 10 * 1024 * 1024 + 1 }),
      /attachments_size_limit/,
    );
  });

  it('名前の無い行は作れない', async () => {
    await assert.rejects(() => insert({ original_filename: '   ' }), /filename_length/);
  });

  it('消した時刻と消した人は、揃っていなければ入らない', async () => {
    await assert.rejects(() => insert({ deleted_at: new Date() }), /deleted_together/);
    await assert.rejects(
      () => insert({ deleted_by_user_id: asuka.userId }),
      /deleted_together/,
    );
  });

  it('同じ保存先を二つの行が指すことはできない', async () => {
    const key = `${org.id}/aa/${uniq()}`;
    await insert({ storage_key: key });
    await assert.rejects(() => insert({ storage_key: key }), /storage_key_uniq/);
  });
});
