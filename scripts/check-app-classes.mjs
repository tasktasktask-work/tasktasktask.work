/**
 * 画面が使っている class が、アプリの CSS に定義されているかを検査する。
 *
 * docs/theme.css には資料だけで使う区画がある。
 * そこに置いたまま画面から使うと、型検査もビルドも通り、テストも通り、
 * ドキュメントの見本は正しく描かれる。壊れるのは本物の画面だけである。
 *
 * 実際に .badge と .card がその状態で本番に出た（2026-09-08）。
 * スレッド一覧の「親からはみ出し」も、組織の一覧のカードも、
 * 枠のない素の文字として並んでいた。
 *
 * 直し方は、その規則を @shared ブロックの中へ移すことである。
 * 移せば pnpm styles:sync が src/styles/ へ写す。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

const STYLES = 'src/styles';
const SOURCE = 'src';

/*
 * 状態や属性で切り替える名前は、CSS 側では属性セレクタで書いてある。
 * ここに並ぶのは「定義が無くて当然」のものだけにする。
 */
const IGNORED = new Set(['on']);

function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...walk(path));
    } else if (extname(path) === '.tsx') {
      found.push(path);
    }
  }
  return found;
}

const css = readdirSync(STYLES)
  .filter((f) => f.endsWith('.css'))
  .map((f) => readFileSync(join(STYLES, f), 'utf8'))
  .join('\n');

const defined = new Set([...css.matchAll(/\.([A-Za-z][\w-]*)/g)].map((m) => m[1]));

/** className="a b" と className={`a ${x}`} の両方から、静的な名前だけを拾う */
const missing = new Map();
for (const file of walk(SOURCE)) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    const names = `${match[1] ?? ''} ${match[2] ?? ''}`.split(/\s+/);
    for (const name of names) {
      // 埋め込みの入った断片は、その場では名前が決まらないので見ない
      if (!name || name.includes('$') || name.includes('{') || IGNORED.has(name)) {
        continue;
      }
      if (!defined.has(name)) {
        const where = missing.get(name) ?? new Set();
        where.add(file);
        missing.set(name, where);
      }
    }
  }
}

if (missing.size === 0) {
  console.log(`\n画面が使う class は、すべて ${STYLES}/ に定義されています。`);
  process.exit(0);
}

console.error('\n定義の無い class が使われています。\n');
for (const [name, files] of [...missing].sort()) {
  console.error(`  .${name}`);
  for (const file of [...files].sort()) {
    console.error(`      ${file}`);
  }
}
console.error(
  [
    '',
    'docs/theme.css の @shared ブロックの外に規則が残っていないか見てください。',
    '外にあるものは資料でしか描かれません。中へ移して pnpm styles:sync を実行します。',
    '',
  ].join('\n'),
);
process.exit(1);
