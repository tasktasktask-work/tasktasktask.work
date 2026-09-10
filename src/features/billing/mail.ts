import { env } from '#lib/env.ts';
import { mailSender } from '#lib/mail.ts';
import { billingPath } from './path.ts';
import { formatDay, formatMoney, UNIT_PRICE } from './plan.ts';

/*
 * おためし期間と凍結の知らせ。
 *
 * 宛先は組織管理者だけである。支払いに進めるのがその人たちだけで、
 * 全員に送ると、動けない人にだけ焦りが届く。
 *
 * notifications テーブルには載せない。
 * あちらはスレッドの出来事を伝えるためのもので、宛先の決め方が違う。
 */

type Target = {
  readonly to: string;
  readonly organizationName: string;
  readonly slug: string;
};

function link(slug: string): string {
  return `${env.APP_ORIGIN}${billingPath(slug)}`;
}

/** 終わりの7日前。まだ慌てる時期ではないので、事実だけ書く。 */
export async function sendTrialEndingSoon(target: Target, trialEndsOn: string): Promise<void> {
  await mailSender.send({
    to: target.to,
    subject: `${target.organizationName} のおためし期間が ${formatDay(trialEndsOn)} に終わります`,
    text: [
      `${target.organizationName} のおためし期間は ${formatDay(trialEndsOn)} までです。`,
      '',
      'その翌日からは、支払い方法を登録するまで書き込みができなくなります。',
      '閲覧と添付のダウンロードは、これまでどおり行えます。',
      '',
      `料金は1人あたり月 ${formatMoney(UNIT_PRICE)}（税込）で、その月に在籍した人数ぶんを翌月に請求します。`,
      '',
      link(target.slug),
      '',
      'このメールは組織管理者に届いています。',
    ].join('\n'),
  });
}

/** 前日。ここで初めて、明日どうなるかを書く。 */
export async function sendTrialEndingTomorrow(
  target: Target,
  trialEndsOn: string,
): Promise<void> {
  await mailSender.send({
    to: target.to,
    subject: `${target.organizationName} のおためし期間が明日で終わります`,
    text: [
      `${target.organizationName} のおためし期間は ${formatDay(trialEndsOn)} までです。`,
      '',
      '明日からは、支払い方法を登録するまで書き込みができなくなります。',
      '登録はこの画面から行えます。',
      '',
      link(target.slug),
      '',
      'このメールは組織管理者に届いています。',
    ].join('\n'),
  });
}

/** 凍結した当日。何ができて何ができないかを、はっきり並べる。 */
export async function sendFrozenByTrial(target: Target): Promise<void> {
  await mailSender.send({
    to: target.to,
    subject: `${target.organizationName} の書き込みを停止しました`,
    text: [
      `${target.organizationName} のおためし期間が終わりました。`,
      '',
      '支払い方法を登録するまで、書き込みができません。',
      'スレッドやコメントの作成、添付のアップロード、メンバーの招待が止まっています。',
      '',
      '閲覧、検索、添付のダウンロードは、これまでどおり行えます。',
      'データは消えません。',
      '',
      link(target.slug),
      '',
      'このメールは組織管理者に届いています。',
    ].join('\n'),
  });
}

/**
 * 請求に失敗して凍結したとき。
 *
 * 巡回ではなく Webhook から送る。ひとつの請求が失敗するのは一度きりなので、
 * 状態が変わった瞬間だけ送れば重複しない。
 */
export async function sendFrozenByPayment(
  target: Target,
  context: { billingMonth: string; amount: number | null },
): Promise<void> {
  const amount = context.amount === null ? '' : `（${formatMoney(context.amount)}）`;
  await mailSender.send({
    to: target.to,
    subject: `${target.organizationName} のお支払いが確認できませんでした`,
    text: [
      `${context.billingMonth}分${amount}のお支払いが確認できませんでした。`,
      '',
      `${target.organizationName} の書き込みを停止しています。`,
      '閲覧と添付のダウンロードは、これまでどおり行えます。',
      '',
      '新しいカードを登録すると、未払いぶんの決済を行います。',
      '通れば、その場で書き込みが元に戻ります。',
      '',
      link(target.slug),
      '',
      'このメールは組織管理者に届いています。',
    ].join('\n'),
  });
}
