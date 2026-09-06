import type { QueryResult } from 'pg';
import { z } from 'zod';

/* ==========================================================================
   クエリ結果への型付け

   ORM を使わないため、SQL の結果に型を与える手段を自分で用意する。
   行の形は手で書き、境界で実行時に検証する。

   検証を挟む理由は、スキーマを変えたときに型定義がずれるからである。
   型注釈だけを付けて実行時に何も確かめないと、
   列名を変えた瞬間から undefined が静かに流れ、
   ずっと後の画面で「なぜか空欄」という形で現れる。

   ここで落とせば、変更した直後のテストと開発中に気づける。
   ========================================================================== */

/** 0 件か 1 件を期待する。0 件なら null を返す。 */
export function one<S extends z.ZodType>(
  schema: S,
  result: QueryResult<Record<string, unknown>>,
  context: string,
): z.infer<S> | null {
  if (result.rows.length === 0) {
    return null;
  }
  if (result.rows.length > 1) {
    throw new Error(`${context}: 1 件を期待しましたが ${result.rows.length} 件返りました`);
  }
  return parse(schema, result.rows[0], context);
}

/** 必ず 1 件返ることを期待する。 */
export function oneOrThrow<S extends z.ZodType>(
  schema: S,
  result: QueryResult<Record<string, unknown>>,
  context: string,
): z.infer<S> {
  const row = one(schema, result, context);
  if (row === null) {
    throw new Error(`${context}: 該当する行がありません`);
  }
  return row;
}

/** 0 件以上を期待する。 */
export function many<S extends z.ZodType>(
  schema: S,
  result: QueryResult<Record<string, unknown>>,
  context: string,
): z.infer<S>[] {
  return result.rows.map((row, i) => parse(schema, row, `${context}[${i}]`));
}

function parse<S extends z.ZodType>(schema: S, row: unknown, context: string): z.infer<S> {
  const parsed = schema.safeParse(row);
  if (!parsed.success) {
    // スキーマとクエリと型定義のどれかがずれている。
    // 落としたほうが、undefined が流れていくより早く直せる。
    throw new Error(
      `${context}: クエリ結果が型と一致しません\n${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}

/* --------------------------------------------------------------------------
   よく使う列の形
   -------------------------------------------------------------------------- */

/**
 * date 列。
 * pg の型パーサを差し替えてあるので 'YYYY-MM-DD' の文字列で来る。
 * Date が来たらパーサの差し替えが効いていないので、ここで落ちる。
 */
export const dateColumn = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 形式ではありません');

/** timestamptz 列。pg が Date にして返す。 */
export const timestampColumn = z.date();

/** bigint 列。pg は精度を守るため文字列で返す。 */
export const bigintColumn = z.string().regex(/^\d+$/).transform(Number);
