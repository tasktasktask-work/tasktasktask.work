/**
 * migrations/ の SQL を、このプロジェクトの規約に照らして検査する。
 *
 * atlas migrate lint は v0.38 から Pro 限定になったので、自前で持つ。
 * 汎用の検査より、docs/devops/database-migration に書いた決まりを
 * そのまま機械にかけるほうが、この構成には合う。
 *
 * 指摘を承知のうえで通したいときは、その文の直前の行に理由を書く。
 *
 *   -- lint-ok: 新規テーブルなので走査するデータがない
 *   CREATE INDEX ...;
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const DIR = 'migrations';

/** @type {{ id: string; test: RegExp; message: string; hint: string }[]} */
const rules = [
  {
    id: 'destructive',
    test: /\b(DROP\s+TABLE|DROP\s+COLUMN|DROP\s+CONSTRAINT)\b/i,
    message: 'データを失う変更が含まれている',
    hint: '足す・両方書く・埋める・読み替える・消す の順に分けて出すこと',
  },
  {
    id: 'column-type-change',
    test: /ALTER\s+COLUMN\s+\S+\s+TYPE\b/i,
    message: '列の型変更はテーブル全体を書き換え、その間ロックを取る',
    hint: '新しい列を足して移し替える手順に分けること',
  },
  {
    id: 'index-not-concurrent',
    test: /^CREATE\s+(UNIQUE\s+)?INDEX\b(?!\s+CONCURRENTLY)/i,
    message: 'CONCURRENTLY のない索引作成は、その間そのテーブルへの書き込みを止める',
    hint: 'CREATE INDEX CONCURRENTLY を使う。ただしトランザクションの中では実行できない',
    skipIfNewTable: true,
  },
  {
    id: 'check-not-valid',
    test: /ADD\s+CONSTRAINT\s+\S+\s+CHECK\b(?![\s\S]*NOT\s+VALID)/i,
    message: '既存行を検査する制約の追加は、テーブル全体を走査してロックを取る',
    hint: 'NOT VALID で足してから、別途 VALIDATE CONSTRAINT すること',
    skipIfNewTable: true,
  },
  {
    id: 'set-not-null',
    test: /ALTER\s+COLUMN\s+\S+\s+SET\s+NOT\s+NULL\b/i,
    message: 'NOT NULL の追加は、既存行の走査とロックを伴う',
    hint: 'CHECK (col IS NOT NULL) NOT VALID → VALIDATE → SET NOT NULL の順に行うこと',
    skipIfNewTable: true,
  },
];

/** 文の対象になっているテーブル名を拾う（単純な取り出し） */
function targetTable(statement) {
  const m =
    statement.match(/\bON\s+"?([A-Za-z0-9_]+)"?/i) ??
    statement.match(/\bALTER\s+TABLE\s+"?([A-Za-z0-9_]+)"?/i);
  return m?.[1] ?? null;
}

let problems = 0;
let checked = 0;

const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

for (const file of files) {
  const source = readFileSync(path.join(DIR, file), 'utf8');
  const lines = source.split('\n');

  // この移行で新しく作られるテーブルは、走査するデータを持たない。
  const newTables = new Set(
    [...source.matchAll(/CREATE\s+TABLE\s+"?([A-Za-z0-9_]+)"?/gi)].map((m) => m[1]),
  );

  // 文の区切りは行末のセミコロン。Atlas の出力はこの形になる。
  let buffer = [];
  let startLine = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (buffer.length === 0) {
      if (line.trim() === '' || line.trim().startsWith('--')) {
        continue;
      }
      startLine = i;
    }
    buffer.push(line);
    if (!line.trimEnd().endsWith(';')) {
      continue;
    }

    const statement = buffer.join('\n');
    const previous = lines[startLine - 1]?.trim() ?? '';
    const allowed = previous.startsWith('-- lint-ok:');
    checked += 1;

    for (const rule of rules) {
      if (!rule.test.test(statement.trim())) {
        continue;
      }
      if (rule.skipIfNewTable) {
        const table = targetTable(statement);
        if (table && newTables.has(table)) {
          continue;
        }
      }
      if (allowed) {
        continue;
      }

      problems += 1;
      console.error(`${DIR}/${file}:${startLine + 1}  [${rule.id}] ${rule.message}`);
      console.error(`    ${statement.split('\n')[0].slice(0, 96)}`);
      console.error(`    → ${rule.hint}`);
      console.error('');
    }

    buffer = [];
  }
}

console.log(`${files.length} ファイル / ${checked} 文を検査しました。`);
if (problems > 0) {
  console.error(`${problems} 件の指摘があります。`);
  console.error('承知のうえで通すなら、その文の直前に "-- lint-ok: 理由" を書いてください。');
  process.exit(1);
}
console.log('規約に反する変更は見つかりませんでした。');
