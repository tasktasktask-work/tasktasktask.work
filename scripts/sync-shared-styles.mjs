/**
 * docs/theme.css の @shared ブロックを src/styles/ へ写す。
 *
 * 意匠の正本は docs/theme.css である。
 * ドキュメントの見本と製品の画面を同じ CSS で描くために、必要な部分だけを写す。
 * 写したファイルは編集しない。整形も docs 側に合わせる（Biome の対象外）。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const DOC = 'docs/theme.css';
const shared = [
  { name: 'tokens', file: 'src/styles/tokens.css' },
  { name: 'product', file: 'src/styles/product.css' },
  { name: 'shell', file: 'src/styles/shell.css' },
];

const head =
  '/* 自動的には生成されない。docs/theme.css の @shared ブロックと同一に保つこと。\n' +
  '   pnpm styles:check が差分を検出する。 */\n\n';

const doc = readFileSync(DOC, 'utf8');

for (const { name, file } of shared) {
  const begin = doc.indexOf(`/* @shared:${name} -`);
  const end = doc.indexOf(`/* @shared:${name} end`);
  if (begin === -1 || end === -1) {
    throw new Error(`${DOC} に @shared:${name} がありません`);
  }
  const body = doc.slice(doc.indexOf('*/', begin) + 2, end).trim();
  writeFileSync(file, `${head + body}\n`);
  console.log(`  写した  ${file}  (${body.split('\n').length} 行)`);
}
