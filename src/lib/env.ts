import { z } from 'zod';
import { lazy } from './lazy.ts';

/*
 * 環境変数は一度だけ検証する。
 * 足りないまま動き出すと、初めてその値を使う画面で初めて落ちる。
 *
 * ただし検証は読み込み時ではなく、最初に触られたときに行う。
 * 読み込み時にやると next build が本番の設定を要求することになる。
 */

const schema = z.object({
  APP_ORIGIN: z.url(),
  DATABASE_URL: z.string().min(1),
  ATTACHMENTS_DIR: z.string().min(1),
  MAIL_TRANSPORT: z.enum(['console', 'smtp']),
  MAIL_FROM: z.string().min(1),
  SMTP_URL: z.string().optional(),
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

  return parsed.data;
}

export const env = lazy(load);
