import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { backHome } from '#features/authentication/landing.ts';
import { consumeMagicLink } from '#features/authentication/magic-link.ts';
import { hashPassword, verifyPassword } from '#features/authentication/password.ts';
import {
  clearLoginFailures,
  findUserByEmail,
  isLocked,
  MAX_FAILED_LOGINS,
  recordFailedLogin,
} from '#features/authentication/queries.ts';
import { safeReturnTo } from '#features/authentication/return-to.ts';
import { createSessionRecord } from '#features/authentication/session.ts';
import { expiresAt, hashToken, issueToken } from '#features/authentication/token.ts';
import { pool } from '#lib/db.ts';

/*
 * 認証は、外から叩かれる唯一の入り口である。
 * ロックとその解除、トークンの一度きり、期限。
 * どれも仕様どおりでなければ、締め出しか乗っ取りのどちらかが起きる。
 *
 * ここでは実データベースを使い、テストごとに作った行を必ず片付ける。
 * pool を共有するため、schema.test.ts のようなトランザクション巻き戻しは使えない。
 */

// 閉じないと、接続が空くまでテストの終了が待たされる
after(async () => {
  await pool.end();
});

let seq = 0;
function uniqueEmail(): string {
  seq += 1;
  return `auth-test-${process.pid}-${seq}@example.com`;
}

async function withUser(
  fn: (user: { id: string; email: string }) => Promise<void>,
  password: string | null = 'correct horse battery',
): Promise<void> {
  const email = uniqueEmail();
  const hash = password === null ? null : await hashPassword(password);
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email, display_name, password_hash) VALUES ($1,$2,$3) RETURNING id`,
    [email, '検証 太郎', hash],
  );
  const id = rows[0]?.id;
  if (!id) {
    throw new Error('ユーザーを作れませんでした');
  }
  try {
    await fn({ id, email });
  } finally {
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    await pool.query('DELETE FROM magic_link_tokens WHERE user_id = $1', [id]);
    await pool.query('DELETE FROM users WHERE id = $1', [id]);
  }
}

describe('パスワード', () => {
  it('照合できる', async () => {
    const hash = await hashPassword('correct horse battery');
    assert.ok(hash.startsWith('$argon2id$'), 'Argon2id で作られていない');
    assert.equal(await verifyPassword(hash, 'correct horse battery'), true);
    assert.equal(await verifyPassword(hash, 'wrong'), false);
  });

  it('8文字未満は受け付けない', async () => {
    await assert.rejects(() => hashPassword('short'));
  });
});

describe('アカウントロック', () => {
  it(`${MAX_FAILED_LOGINS} 回連続で失敗するとロックする`, async () => {
    await withUser(async (user) => {
      for (let i = 1; i < MAX_FAILED_LOGINS; i += 1) {
        const locked = await recordFailedLogin(user.id);
        assert.equal(locked, false, `${i} 回目でロックされた`);
      }
      assert.equal(
        await recordFailedLogin(user.id),
        true,
        `${MAX_FAILED_LOGINS} 回目でロックされない`,
      );

      const found = await findUserByEmail(user.email);
      assert.ok(found && isLocked(found), 'ロックが記録されていない');
    });
  });

  it('時間では解除されない', async () => {
    await withUser(async (user) => {
      for (let i = 0; i < MAX_FAILED_LOGINS; i += 1) {
        await recordFailedLogin(user.id);
      }
      // 時間経過による解除はどこにも実装していない。列を直接見て確かめる。
      const { rows } = await pool.query<{ locked_at: Date | null }>(
        'SELECT locked_at FROM users WHERE id = $1',
        [user.id],
      );
      assert.ok(rows[0]?.locked_at instanceof Date, 'ロックが外れている');
    });
  });

  it('成功したら失敗回数もロックも戻る', async () => {
    await withUser(async (user) => {
      for (let i = 0; i < MAX_FAILED_LOGINS; i += 1) {
        await recordFailedLogin(user.id);
      }
      await clearLoginFailures(user.id);

      const found = await findUserByEmail(user.email);
      assert.ok(found);
      assert.equal(found.failedLoginCount, 0);
      assert.equal(isLocked(found), false);
    });
  });
});

describe('マジックリンク', () => {
  const issue = async (userId: string, hours = 48) => {
    const { token, hash } = issueToken();
    await pool.query(
      'INSERT INTO magic_link_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)',
      [userId, hash, expiresAt(hours)],
    );
    return token;
  };

  it('使うとログインでき、セッションが作られる', async () => {
    await withUser(async (user) => {
      const token = await issue(user.id);
      const result = await consumeMagicLink(token);
      assert.equal(result.ok, true);
      if (!result.ok) {
        return;
      }
      assert.equal(result.userId, user.id);

      const { rows } = await pool.query('SELECT 1 FROM sessions WHERE user_id = $1', [user.id]);
      assert.equal(rows.length, 1, 'セッションが作られていない');
    });
  });

  it('ロックを解除する', async () => {
    await withUser(async (user) => {
      for (let i = 0; i < MAX_FAILED_LOGINS; i += 1) {
        await recordFailedLogin(user.id);
      }
      assert.ok(isLocked((await findUserByEmail(user.email)) ?? ({ lockedAt: null } as never)));

      const token = await issue(user.id);
      assert.equal((await consumeMagicLink(token)).ok, true);

      const found = await findUserByEmail(user.email);
      assert.ok(found);
      assert.equal(isLocked(found), false, 'ロックが解除されていない');
      assert.equal(found.failedLoginCount, 0);
    });
  });

  it('一度使うと無効になる', async () => {
    await withUser(async (user) => {
      const token = await issue(user.id);
      assert.equal((await consumeMagicLink(token)).ok, true);

      const again = await consumeMagicLink(token);
      assert.equal(again.ok, false);
      if (!again.ok) {
        assert.equal(again.reason, 'used');
      }
    });
  });

  it('期限が切れていたら使えない', async () => {
    await withUser(async (user) => {
      const token = await issue(user.id, -1);
      const result = await consumeMagicLink(token);
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.reason, 'expired');
      }
    });
  });

  it('知らないトークンは使えない', async () => {
    const result = await consumeMagicLink(issueToken().token);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.reason, 'invalid');
    }
  });
});

describe('トークンの保存', () => {
  it('生の値をデータベースに残さない', async () => {
    await withUser(async (user) => {
      const session = await createSessionRecord(user.id);

      const { rows } = await pool.query<{ token_hash: Buffer }>(
        'SELECT token_hash FROM sessions WHERE user_id = $1',
        [user.id],
      );
      const stored = rows[0]?.token_hash;
      assert.ok(stored, 'セッションが無い');
      assert.ok(Buffer.isBuffer(stored), 'ハッシュとして保存されていない');
      assert.notEqual(stored.toString('utf8'), session.token, '生の値が保存されている');
      assert.ok(stored.equals(hashToken(session.token)), 'ハッシュが一致しない');
    });
  });
});

describe('ログイン後の戻り先', () => {
  it('サイトの中のパスはそのまま通す', () => {
    for (const path of ['/', '/o/acme', '/o/acme/p/WEB/t/128', '/o/acme/p/WEB?tag=bug']) {
      assert.equal(safeReturnTo(path), path, `${path} が書き換えられた`);
    }
  });

  it('外を指すものは受け付けない', () => {
    const outside = [
      'https://evil.example.com',
      '//evil.example.com',
      '/\\evil.example.com',
      'evil.example.com',
      'javascript:alert(1)',
      '',
      null,
      undefined,
      42,
    ];
    for (const value of outside) {
      assert.equal(safeReturnTo(value), '/', `${String(value)} が通った`);
    }
  });

  it('途中に制御文字が挟まっているものは受け付けない', () => {
    const CR = String.fromCharCode(13);
    const LF = String.fromCharCode(10);
    // ヘッダを分割しようとする値
    assert.equal(safeReturnTo(`/o/acme${CR}${LF}Set-Cookie: a=b`), '/');
    assert.equal(safeReturnTo(`/o/${LF}acme`), '/');
  });

  it('前後の空白は取り除いたうえで判定する', () => {
    // 取り除いた結果が安全なら、その値を使う
    assert.equal(safeReturnTo(`  /o/acme${String.fromCharCode(9)}`), '/o/acme');
    assert.equal(safeReturnTo('  //evil.example.com  '), '/');
  });

  it('認証の途中経過へは戻さない', () => {
    assert.equal(safeReturnTo('/auth/magic?token=xxx'), '/');
  });
});

/* --------------------------------------------------------------------------
   マジックリンクから戻る先
   -------------------------------------------------------------------------- */

describe('マジックリンクから戻る先', () => {
  /*
   * 本番で 0.0.0.0 へ飛ばされた（2026-09-08）。
   * NextRequest の nextUrl が Host ヘッダではなく、サーバが束ねている
   * ホスト名を返すためである。ここで絶対URLを組まないことを固定する。
   */
  it('行き先にホスト名が入らない', () => {
    for (const response of [backHome(), backHome('used'), backHome('expired')]) {
      const location = response.headers.get('Location') ?? '';
      assert.ok(location.startsWith('/'), location);
      assert.ok(!location.includes('://'), location);
      assert.ok(!location.startsWith('//'), `オリジンを乗っ取られる形: ${location}`);
    }
  });

  it('理由がなければ入口へ戻す', () => {
    assert.equal(backHome().headers.get('Location'), '/');
  });

  it('理由は問い合わせに載る', () => {
    assert.equal(backHome('expired').headers.get('Location'), '/?magic=expired');
  });

  it('理由に何を入れてもパスは動かない', () => {
    // 理由は consumeMagicLink が返す値だが、組み立ての側でも閉じておく
    const location = backHome('//evil.example.com').headers.get('Location') ?? '';
    assert.ok(location.startsWith('/?magic='), location);
    assert.ok(!location.includes('evil.example.com/'), location);
  });

  it('本文は持たせず、307 で返す', () => {
    const response = backHome();
    assert.equal(response.status, 307);
    assert.equal(response.body, null);
  });
});
