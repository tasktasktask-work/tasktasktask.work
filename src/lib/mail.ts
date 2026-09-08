import type { Transporter } from 'nodemailer';
import nodemailer from 'nodemailer';
import { env } from './env.ts';
import { lazy } from './lazy.ts';

/* ==========================================================================
   メール送信

   マジックリンク、招待、通知の三つがメールに依存している。
   送信先を差し替えられるよう、呼び出し側はこの抽象しか触らない。

   開発中はコンソールへ出す。本番は Cloudflare Email Service へ SMTP で送る。
   SMTP で送るため Cloudflare 固有の実装に縛られず、
   別のサービスへ移すときも接続設定の差し替えで済む。

   マジックリンクと招待は、リクエストの中で送り切る。
   通知だけが行に積まれ、巡回で送られる
   （src/features/notification/mailer.ts）。
   ログインは待っている人の目の前で起きるので、
   一分遅れて届く形にすると、遅れがそのまま見える。
   ========================================================================== */

export type Mail = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
};

/**
 * 送れなかった理由。
 *
 * 恒久と一時を分けるのは、通知の巡回が「諦めるか、あとでもう一度試すか」を
 * 決めるためである。回数だけで諦めると、Cloudflare 側が数分止まった間の
 * 通知がまとめて捨てられる。
 *
 * SMTP はこの二つを応答コードで分けている。
 * 5xx は恒久（そんな宛先は無い）、4xx は一時（いまは受けられない）。
 * 接続そのものの失敗はコードを持たないので、一時として扱う。
 * 相手が居ないのか、経路が切れているだけなのかを、こちらからは区別できない。
 */
export class MailFailure extends Error {
  readonly permanent: boolean;

  constructor(message: string, options: { permanent: boolean; cause?: unknown }) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'MailFailure';
    this.permanent = options.permanent;
  }
}

export interface MailSender {
  send(mail: Mail): Promise<void>;
}

class ConsoleMailSender implements MailSender {
  async send(mail: Mail): Promise<void> {
    console.info(
      [
        '',
        '--- mail ---',
        `To: ${mail.to}`,
        `Subject: ${mail.subject}`,
        '',
        mail.text,
        '------------',
        '',
      ].join('\n'),
    );
  }
}

/** nodemailer が投げてくるものから応答コードを拾う。 */
function responseCode(err: unknown): number | null {
  if (typeof err !== 'object' || err === null) {
    return null;
  }
  const code = (err as { responseCode?: unknown }).responseCode;
  return typeof code === 'number' ? code : null;
}

class SmtpMailSender implements MailSender {
  // 接続は使い回す。巡回のたびに張り直すと、一分ごとに握手が増える。
  private readonly transport: Transporter = nodemailer.createTransport(
    // env は SMTP_URL の有無をここに来る前に検査している。
    env.SMTP_URL ?? '',
    { from: env.MAIL_FROM },
  );

  async send(mail: Mail): Promise<void> {
    try {
      const info = await this.transport.sendMail({
        from: env.MAIL_FROM,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
      });

      /*
       * 接続も本文も通ったのに、宛先だけ拒まれることがある。
       * nodemailer はこれを例外にせず rejected に入れて返す。
       * 見落とすと「送った」ことになり、二度と拾われない。
       */
      const rejected = info.rejected ?? [];
      if (rejected.length > 0) {
        throw new MailFailure(`宛先が拒否されました: ${rejected.join(', ')}`, {
          permanent: true,
        });
      }
    } catch (err) {
      if (err instanceof MailFailure) {
        throw err;
      }
      const code = responseCode(err);
      throw new MailFailure(err instanceof Error ? err.message : String(err), {
        permanent: code !== null && code >= 500 && code < 600,
        cause: err,
      });
    }
  }
}

// 実装の選択は env を読む。読み込み時ではなく、最初に送るときに決める。
export const mailSender = lazy<MailSender>(() =>
  env.MAIL_TRANSPORT === 'console' ? new ConsoleMailSender() : new SmtpMailSender(),
);
