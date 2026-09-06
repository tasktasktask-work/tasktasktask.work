import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { newThread, rejects, seed, withRollback } from './helpers.ts';

/*
 * スキーマが仕様どおりに振る舞うかを、実データベースで確かめる。
 *
 * ここで守っているのは、アプリケーションが間違えても
 * データベースが受け付けない、という一線である。
 * 画面の制御だけに任せると、API を直接叩かれたときや
 * 運用中の手作業で崩れる。
 */

describe('スレッドの種別ごとの制約', () => {
  it('議論と質問は期間を持てない', async () => {
    await withRollback(async (c) => {
      const f = await seed(c);
      const giron = await newThread(c, f, f.web, 'giron', '検索の要件をどうするか');
      await rejects(
        c,
        () =>
          c.query('UPDATE threads SET starts_on=$1, ends_on=$2 WHERE id=$3', [
            '2026-09-01',
            '2026-09-10',
            giron.id,
          ]),
        '議論に期間',
      );
    });
  });

  it('議論と質問の進捗率は 0 か 100 しか取らない', async () => {
    await withRollback(async (c) => {
      const f = await seed(c);
      const q = await newThread(c, f, f.web, 'shitsumon', '全角の正規化はどこでやっている？');
      await rejects(
        c,
        () => c.query('UPDATE threads SET progress=45 WHERE id=$1', [q.id]),
        '質問の進捗率 45',
      );
      await c.query('UPDATE threads SET progress=100 WHERE id=$1', [q.id]);
    });
  });

  it('課題は 0 から 100 の任意の値を取れる', async () => {
    await withRollback(async (c) => {
      const f = await seed(c);
      const k = await newThread(c, f, f.web, 'kadai', '検索APIの実装');
      for (const p of [0, 1, 40, 99, 100]) {
        await c.query('UPDATE threads SET progress=$1 WHERE id=$2', [p, k.id]);
      }
      await rejects(
        c,
        () => c.query('UPDATE threads SET progress=101 WHERE id=$1', [k.id]),
        '進捗率 101',
      );
    });
  });

  it('期間は両方入れるか両方空けるか', async () => {
    await withRollback(async (c) => {
      const f = await seed(c);
      const k = await newThread(c, f, f.web, 'kadai', '検索APIの実装');
      await rejects(
        c,
        () => c.query('UPDATE threads SET starts_on=$1 WHERE id=$2', ['2026-09-08', k.id]),
        '開始日だけ',
      );
      await rejects(
        c,
        () =>
          c.query('UPDATE threads SET starts_on=$1, ends_on=$2 WHERE id=$3', [
            '2026-09-20',
            '2026-09-10',
            k.id,
          ]),
        '終了日が開始日より前',
      );
      await c.query('UPDATE threads SET starts_on=$1, ends_on=$2 WHERE id=$3', [
        '2026-09-08',
        '2026-09-19',
        k.id,
      ]);
    });
  });
});

describe('親子関係', () => {
  it('種別はまたげる', async () => {
    await withRollback(async (c) => {
      const f = await seed(c);
      const giron = await newThread(c, f, f.web, 'giron', '検索の要件をどうするか');
      const kadai = await newThread(c, f, f.web, 'kadai', '検索APIの実装', {
        parent_thread_id: giron.id,
      });
      const q = await newThread(c, f, f.web, 'shitsumon', '正規化は？', {
        parent_thread_id: kadai.id,
      });
      assert.ok(q.id);
    });
  });

  it('プロジェクトはまたげない', async () => {
    await withRollback(async (c) => {
      const f = await seed(c);
      const web = await newThread(c, f, f.web, 'giron', '検索の要件をどうするか');
      const bill = await newThread(c, f, f.bill, 'kadai', '請求書PDFの様式変更');
      await rejects(
        c,
        () => c.query('UPDATE threads SET parent_thread_id=$1 WHERE id=$2', [web.id, bill.id]),
        'プロジェクトまたぎの親子',
      );
    });
  });

  it('自分自身を親にできない', async () => {
    await withRollback(async (c) => {
      const f = await seed(c);
      const k = await newThread(c, f, f.web, 'kadai', '検索APIの実装');
      await rejects(
        c,
        () => c.query('UPDATE threads SET parent_thread_id=id WHERE id=$1', [k.id]),
        '自己参照',
      );
    });
  });
});

describe('アーカイブと論理削除', () => {
  it('アーカイブを経ないと削除できない', async () => {
    await withRollback(async (c) => {
      const f = await seed(c);
      const k = await newThread(c, f, f.web, 'kadai', '検索APIの実装');
      await rejects(
        c,
        () => c.query('UPDATE threads SET deleted_at=now() WHERE id=$1', [k.id]),
        'いきなり削除',
      );
      await c.query('UPDATE threads SET archived_at=now(), deleted_at=now() WHERE id=$1', [
        k.id,
      ]);
    });
  });
});

describe('スレッド番号', () => {
  it('組織の中で通し番号になり、プロジェクトをまたいで重複しない', async () => {
    await withRollback(async (c) => {
      const f = await seed(c);
      const a = await newThread(c, f, f.web, 'giron', 'A');
      const b = await newThread(c, f, f.bill, 'kadai', 'B');
      const d = await newThread(c, f, f.web, 'kadai', 'C');
      assert.deepEqual([b.number - a.number, d.number - b.number], [1, 1], '番号が連番でない');

      await rejects(
        c,
        () =>
          c.query(
            `INSERT INTO threads (organization_id, project_id, number, type, title, created_by_user_id)
             VALUES ($1,$2,$3,'kadai','重複',$4)`,
            [f.org, f.web, a.number, f.asuka],
          ),
        '番号の重複',
      );
    });
  });
});

describe('メールアドレス', () => {
  it('小文字でなければ受け付けない', async () => {
    await withRollback(async (c) => {
      await rejects(
        c,
        () =>
          c.query('INSERT INTO users (email, display_name) VALUES ($1,$2)', [
            'Foo@Example.com',
            '大文字',
          ]),
        '大文字のメールアドレス',
      );
    });
  });
});

describe('添付ファイル', () => {
  it('スレッドかコメントの一方にだけ付く', async () => {
    await withRollback(async (c) => {
      const f = await seed(c);
      const k = await newThread(c, f, f.web, 'kadai', '検索APIの実装');
      const insert = (thread: string | null, comment: string | null) =>
        c.query(
          `INSERT INTO attachments (organization_id, thread_id, comment_id, storage_key,
                                    original_filename, byte_size, uploaded_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [f.org, thread, comment, `key-${Math.random()}`, 'a.png', 1024, f.asuka],
        );
      await rejects(c, () => insert(k.id, k.id), '両方に付ける');
      await rejects(c, () => insert(null, null), 'どちらにも付けない');
      await insert(k.id, null);
    });
  });

  it('10MB を超えられない', async () => {
    await withRollback(async (c) => {
      const f = await seed(c);
      const k = await newThread(c, f, f.web, 'kadai', '検索APIの実装');
      await rejects(
        c,
        () =>
          c.query(
            `INSERT INTO attachments (organization_id, thread_id, storage_key, original_filename,
                                      byte_size, uploaded_by_user_id)
             VALUES ($1,$2,'big','big.zip',$3,$4)`,
            [f.org, k.id, 10 * 1024 * 1024 + 1, f.asuka],
          ),
        '10MB 超',
      );
    });
  });
});

describe('通知', () => {
  it('自分の操作で自分に通知は作れない', async () => {
    await withRollback(async (c) => {
      const f = await seed(c);
      const k = await newThread(c, f, f.web, 'kadai', '検索APIの実装');
      await rejects(
        c,
        () =>
          c.query(
            `INSERT INTO notifications (organization_id, user_id, kind, thread_id, actor_user_id)
             VALUES ($1,$2,'assigned',$3,$2)`,
            [f.org, f.asuka, k.id],
          ),
        '自分から自分へ',
      );
      await c.query(
        `INSERT INTO notifications (organization_id, user_id, kind, thread_id, actor_user_id)
         VALUES ($1,$2,'assigned',$3,$4)`,
        [f.org, f.ryo, k.id, f.asuka],
      );
    });
  });
});

describe('updated_at のトリガ', () => {
  it('手で入れた古い値を上書きする', async () => {
    await withRollback(async (c) => {
      const f = await seed(c);
      // now() はトランザクション開始時刻を返すので、同一トランザクションでは進まない。
      // トリガが効いているかは、古い値が上書きされるかで見る。
      await c.query('UPDATE organizations SET updated_at=$1 WHERE id=$2', [
        '2000-01-01T00:00:00Z',
        f.org,
      ]);
      const { rows } = await c.query<{ updated_at: Date }>(
        'SELECT updated_at FROM organizations WHERE id=$1',
        [f.org],
      );
      assert.ok(rows[0] && rows[0].updated_at.getUTCFullYear() > 2020, 'トリガが効いていない');
    });
  });
});

describe('日付の型', () => {
  it('date は文字列として返る', async () => {
    await withRollback(async (c) => {
      const f = await seed(c);
      const k = await newThread(c, f, f.web, 'kadai', '検索APIの実装', {
        starts_on: '2026-09-08',
        ends_on: '2026-09-19',
      });
      const { rows } = await c.query('SELECT starts_on, ends_on FROM threads WHERE id=$1', [
        k.id,
      ]);
      // 型パーサを差し替えていないと Date になり、タイムゾーン次第で日付がずれる
      assert.equal(rows[0]?.starts_on, '2026-09-08');
      assert.equal(rows[0]?.ends_on, '2026-09-19');
    });
  });
});
