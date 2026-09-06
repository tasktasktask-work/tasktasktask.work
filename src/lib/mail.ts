import { env } from './env.ts';
import { lazy } from './lazy.ts';

/* ==========================================================================
   メール送信

   マジックリンク、招待、通知の三つがメールに依存している。
   送信先を差し替えられるよう、呼び出し側はこの抽象しか触らない。

   開発中はコンソールへ出す。本番は Cloudflare Email Service へ SMTP で送る。
   SMTP で送るため Cloudflare 固有の実装に縛られず、
   別のサービスへ移すときも接続設定の差し替えで済む。
   ========================================================================== */

export type Mail = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
};

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

class SmtpMailSender implements MailSender {
  async send(_mail: Mail): Promise<void> {
    // SMTP クライアントの依存を決めてから実装する。
    // 送信先は smtp.mx.cloudflare.net:465。
    throw new Error('SMTP の送信はまだ実装されていません');
  }
}

// 実装の選択は env を読む。読み込み時ではなく、最初に送るときに決める。
export const mailSender = lazy<MailSender>(() =>
  env.MAIL_TRANSPORT === 'console' ? new ConsoleMailSender() : new SmtpMailSender(),
);
