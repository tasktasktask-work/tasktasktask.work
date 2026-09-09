import { TOKEN_LIFETIME_HOURS } from '#features/authentication/token.ts';
import { env } from '#lib/env.ts';
import { mailSender } from '#lib/mail.ts';

/*
 * 招待のメール。
 *
 * 受け取る人は、このサービスをまだ知らないことが多い。
 * 誰が、どの組織へ呼んでいるのかを先に書く。
 * それが無いと、心当たりのないリンクだけが届いたことになる。
 */

export async function sendInvitation(
  to: string,
  token: string,
  context: { organizationName: string; inviterName: string },
): Promise<void> {
  const url = `${env.APP_ORIGIN}/join?token=${encodeURIComponent(token)}`;
  await mailSender.send({
    to,
    subject: `${context.organizationName} から TASK3 への招待が届いています`,
    text: [
      `${context.inviterName} さんが、あなたを ${context.organizationName} に招待しました。`,
      '',
      '下のリンクを開くと参加できます。',
      '',
      url,
      '',
      `このリンクは${TOKEN_LIFETIME_HOURS}時間で切れ、一度使うと無効になります。`,
      '切れてしまった場合は、招待した人に送り直しを頼んでください。',
      '',
      '心当たりがなければ、このメールは破棄してください。',
      'リンクを開かないかぎり、何も起きません。',
    ].join('\n'),
  });
}

/**
 * 組織登録の確認リンク。
 *
 * すでにアカウントがある人にも、同じ文面を送る。
 * 「登録済みです」と書き分けると、どちらのメールが届いたかで
 * そのアドレスの登録の有無が分かってしまう。
 */
export async function sendSignupLink(to: string, token: string): Promise<void> {
  const url = `${env.APP_ORIGIN}/signup?token=${encodeURIComponent(token)}`;
  await mailSender.send({
    to,
    subject: 'TASK3 で組織を作る',
    text: [
      '下のリンクを開くと、組織の名前を決める画面に進みます。',
      '',
      url,
      '',
      `このリンクは${TOKEN_LIFETIME_HOURS}時間で切れ、一度使うと無効になります。`,
      '組織を作った人が、その組織の管理者になります。',
      '',
      '心当たりがなければ、このメールは破棄してください。',
      'リンクを開かないかぎり、何も起きません。',
    ].join('\n'),
  });
}
