import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { lazy } from '#lib/lazy.ts';

/*
 * 遅延化は、タイミングそのものが仕様である。
 *
 * モジュールの読み込みで実行時の設定を要求すると、
 * next build がイメージを作るときにも本番の接続先を求めることになる。
 * 「読み込みでは作らない」が壊れたときに気づけるようにしておく。
 */

describe('lazy', () => {
  it('触るまで作らない', () => {
    let created = 0;
    const value = lazy(() => {
      created += 1;
      return { greeting: 'こんにちは' };
    });

    assert.equal(created, 0, '読み込みだけで作られている');
    assert.equal(value.greeting, 'こんにちは');
    assert.equal(created, 1);
  });

  it('二度目からは作り直さない', () => {
    let created = 0;
    const value = lazy(() => {
      created += 1;
      return { n: created };
    });

    assert.equal(value.n, 1);
    assert.equal(value.n, 1);
    assert.equal(created, 1, '作り直されている');
  });

  it('メソッドの this が実体を指す', () => {
    const value = lazy(() => ({
      name: 'スレッド',
      describe(): string {
        return `${this.name}です`;
      },
    }));

    // this が Proxy のままだと壊れるものがあるので、実体に束ねている
    assert.equal(value.describe(), 'スレッドです');
  });

  it('作るときの失敗は、触った側へ伝わる', () => {
    const value = lazy<{ a: string }>(() => {
      throw new Error('設定が足りません');
    });

    assert.throws(() => value.a, /設定が足りません/);
  });

  it('in と Object.keys が使える', () => {
    const value = lazy(() => ({ a: 1, b: 2 }));
    assert.equal('a' in value, true);
    assert.deepEqual(Object.keys(value).sort(), ['a', 'b']);
  });
});
