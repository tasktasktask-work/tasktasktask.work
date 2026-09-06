/**
 * docs/theme.css と src/styles/*.css の共有ブロックが一致しているかを検査する。
 *
 * ドキュメントの見本と製品の見た目は同じ CSS で描かれている。
 * 片方だけを直すと、設計書と実物が静かにずれていく。
 * ずれたことに気づく手段がないので、機械的に照合する。
 */
import { readFileSync } from 'node:fs';

const DOC = 'docs/theme.css';

/** @type {{ name: string; file: string }[]} */
const shared = [
  { name: 'tokens', file: 'src/styles/tokens.css' },
  { name: 'product', file: 'src/styles/product.css' },
  { name: 'shell', file: 'src/styles/shell.css' },
];

/** docs/theme.css から @shared:<name> ... @shared:<name> end の中身を取り出す */
function extract(source, name) {
  const begin = source.indexOf(`/* @shared:${name} -`);
  const end = source.indexOf(`/* @shared:${name} end`);
  if (begin === -1 || end === -1) {
    throw new Error(`${DOC} に @shared:${name} の目印が見つかりません`);
  }
  const bodyStart = source.indexOf('*/', begin) + 2;
  return source.slice(bodyStart, end).trim();
}

/** アプリ側のファイルから、先頭の注記を除いた中身を取り出す */
function body(source) {
  const end = source.indexOf('*/');
  return source.slice(end === -1 ? 0 : end + 2).trim();
}

let failed = 0;
const doc = readFileSync(DOC, 'utf8');

for (const { name, file } of shared) {
  const a = extract(doc, name);
  const b = body(readFileSync(file, 'utf8'));
  if (a === b) {
    console.log(`  ok   ${name.padEnd(8)} ${DOC} = ${file}`);
    continue;
  }
  failed += 1;
  console.error(`  NG   ${name.padEnd(8)} ${DOC} と ${file} が食い違っています`);

  const la = a.split('\n');
  const lb = b.split('\n');
  for (let i = 0; i < Math.max(la.length, lb.length); i += 1) {
    if (la[i] !== lb[i]) {
      console.error(`       ${i + 1} 行目から差があります`);
      console.error(`         ${DOC}: ${la[i] ?? '(なし)'}`);
      console.error(`         ${file}: ${lb[i] ?? '(なし)'}`);
      break;
    }
  }
}

if (failed > 0) {
  console.error('\n共有スタイルがずれています。どちらかに合わせてください。');
  process.exit(1);
}
console.log('共有スタイルは一致しています。');
