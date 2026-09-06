/**
 * 実行時の設定が要るものを、最初に触られるまで作らない。
 *
 * モジュールの読み込みで作ってしまうと、`next build` がページの情報を集める
 * ときにも設定を要求することになる。
 * つまり**イメージを作るのに本番の接続先が要る**という依存が生まれ、
 * 手元の .env が写り込んでいるあいだだけ通る、という状態になる。
 *
 * 呼ぶ側の書き方は変えない。`pool.query(...)` のまま、
 * 最初の呼び出しでプールが作られる。
 */
export function lazy<T extends object>(create: () => T): T {
  let value: T | undefined;
  const resolve = (): T => {
    value ??= create();
    return value;
  };

  return new Proxy({} as T, {
    get(_target, key, receiver) {
      const instance = resolve();
      const property = Reflect.get(instance, key, receiver);
      // メソッドは実体に束ねる。this が Proxy のままだと壊れるものがある。
      return typeof property === 'function' ? property.bind(instance) : property;
    },
    set(_target, key, next) {
      return Reflect.set(resolve(), key, next);
    },
    has(_target, key) {
      return Reflect.has(resolve(), key);
    },
    ownKeys() {
      return Reflect.ownKeys(resolve());
    },
    getOwnPropertyDescriptor(_target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(resolve(), key);
      // 空の実体に対して「変更できない属性がある」と答えると
      // Proxy の不変条件に反するため、ここで緩める。
      if (descriptor) {
        descriptor.configurable = true;
      }
      return descriptor;
    },
  });
}
