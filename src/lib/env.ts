import { z } from 'zod';
import { lazy } from './lazy.ts';

/*
 * 環境変数は一度だけ検証する。
 * 足りないまま動き出すと、初めてその値を使う画面で初めて落ちる。
 *
 * ただし検証は読み込み時ではなく、最初に触られたときに行う。
 * 読み込み時にやると next build が本番の設定を要求することになる。
 */

/*
 * 課金の動かし方。
 *
 *   off    課金の判定をしない。すべての組織が書き込める。請求も走らない
 *   fake   Stripe を呼ばない。押すとその場で登録済みになる。ブラウザ試験用
 *   stripe 本物の Stripe を使う
 *
 * MAIL_TRANSPORT と同じ形にしてある。作法を増やさない。
 */
const billingModes = z.enum(['off', 'fake', 'stripe']);
export type BillingMode = z.infer<typeof billingModes>;

const schema = z.object({
  APP_ORIGIN: z.url(),
  DATABASE_URL: z.string().min(1),
  ATTACHMENTS_DIR: z.string().min(1),
  MAIL_TRANSPORT: z.enum(['console', 'smtp']),
  MAIL_FROM: z.string().min(1),
  SMTP_URL: z.string().optional(),
  BILLING_MODE: billingModes.default('off'),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`環境変数が正しくありません:\n${z.prettifyError(parsed.error)}`);
  }

  // 本番でメールを送るなら SMTP_URL が要る
  if (parsed.data.MAIL_TRANSPORT === 'smtp' && !parsed.data.SMTP_URL) {
    throw new Error('MAIL_TRANSPORT=smtp のときは SMTP_URL が必要です');
  }

  // 本物の Stripe を使うなら、鍵と署名の秘密が要る
  if (parsed.data.BILLING_MODE === 'stripe') {
    const lacking = [
      parsed.data.STRIPE_SECRET_KEY ? null : 'STRIPE_SECRET_KEY',
      parsed.data.STRIPE_WEBHOOK_SECRET ? null : 'STRIPE_WEBHOOK_SECRET',
    ].filter((k) => k !== null);
    if (lacking.length > 0) {
      throw new Error(`BILLING_MODE=stripe のときは ${lacking.join(' と ')} が必要です`);
    }
  }

  return parsed.data;
}

export const env = lazy(load);

/**
 * 課金の動かし方だけを、env() を通さずに読む。
 *
 * SQL の断片を組み立てる側（#lib/db.ts）がこれを見る。
 * env() は全部の環境変数を検証するので、読み込みの時点で呼ぶと
 * next build が本番の設定を要求することになる。
 * ここは呼ばれた時点で一つの変数だけを見る。
 */
export function billingMode(): BillingMode {
  const parsed = billingModes.safeParse(process.env.BILLING_MODE ?? 'off');
  if (!parsed.success) {
    throw new Error(
      `BILLING_MODE は off / fake / stripe のいずれかです: ${process.env.BILLING_MODE}`,
    );
  }
  return parsed.data;
}
