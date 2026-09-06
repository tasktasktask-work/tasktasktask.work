import { env } from '#lib/env.ts';
import { mailSender } from '#lib/mail.ts';
import { TOKEN_LIFETIME_HOURS } from './token.ts';

/*
 * 認証にまつわるメールの文面。
 * 文面を一箇所にまとめておくと、送る条件を読み違えにくい。
 */

export async function sendMagicLink(to: string, token: string): Promise<void> {
  const url = `${env.APP_ORIGIN}/auth/magic?token=${encodeURIComponent(token)}`;
  await mailSender.send({
    to,
    subject: 'TASK3 へのログイン',
    text: [
      '下のリンクを開くとログインできます。',
      '',
      url,
      '',
      `このリンクは${TOKEN_LIFETIME_HOURS}時間で切れ、一度使うと無効になります。`,
      'パスワードでのログインが止まっている場合も、このリンクで入れば解除されます。',
      '',
      '心当たりがなければ、このメールは破棄してください。',
    ].join('\n'),
  });
}

/**
 * ロックがかかったことを本人に知らせる。
 *
 * この通知がないと、第三者にでたらめなパスワードを送られて締め出された人は、
 * 理由も解除方法もわからないまま止まる。
 */
export async function sendAccountLocked(to: string): Promise<void> {
  await mailSender.send({
    to,
    subject: 'TASK3 のパスワードログインを停止しました',
    text: [
      'パスワードの入力が続けて失敗したため、このアカウントでの',
      'パスワードログインを停止しました。',
      '',
      `${env.APP_ORIGIN}/login からログイン用リンクを受け取ると、その場で解除されます。`,
      '',
      '心当たりがない場合、誰かがあなたのアカウントに入ろうとした可能性があります。',
      'ログイン用リンクで入り、パスワードを変更してください。',
    ].join('\n'),
  });
}
