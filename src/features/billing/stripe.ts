import { randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import { env } from '#lib/env.ts';
import { lazy } from '#lib/lazy.ts';
import { CURRENCY, formatBillingMonth, formatMoney, UNIT_PRICE } from './plan.ts';

/* ==========================================================================
   決済代行への口

   このプロジェクトが外へ通信する二つめの相手である（一つめは SMTP）。
   呼ぶ側はこの型しか見ない。BILLING_MODE で中身が入れ替わる。

   カード番号はここを通らない。登録も変更も Stripe の画面で行う。
   ========================================================================== */

export type IssuedInvoice = {
  readonly id: string;
  readonly pdfUrl: string | null;
  readonly tax: number | null;
  readonly total: number | null;
};

export type WebhookEvent =
  | { readonly kind: 'paid'; readonly stripeInvoiceId: string }
  | { readonly kind: 'failed'; readonly stripeInvoiceId: string }
  | { readonly kind: 'ignored' };

export interface BillingGateway {
  /** 顧客を作る。すでに作ってあれば、その id をそのまま返す。 */
  ensureCustomer(input: {
    name: string;
    email: string;
    existing: string | null;
  }): Promise<string>;

  /** カードと住所を預ける画面の URL。住所は請求書の宛先になる。 */
  setupUrl(input: {
    customerId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<string>;

  /** カードと住所を変える画面の URL。 */
  portalUrl(input: { customerId: string; returnUrl: string }): Promise<string>;

  /**
   * 支払い方法が実際に使えることを確かめ、既定として据える。
   *
   * Checkout から戻ったその場で呼ぶ。
   * 最初の請求まで1ヶ月以上空くことがあり、
   * そのあいだ使えないカードを預かったまま気づかない状態を避ける。
   */
  confirmPaymentMethod(customerId: string): Promise<boolean>;

  /** 請求書を作って確定する。金額は税込で、税を別に足さない。 */
  issueInvoice(input: {
    customerId: string;
    billingMonth: string;
    memberCount: number;
    subtotal: number;
    idempotencyKey: string;
  }): Promise<IssuedInvoice>;

  /** 決済を試す。自動再試行は使わない。一度で決める。 */
  payInvoice(stripeInvoiceId: string): Promise<boolean>;

  /** 署名を確かめて、扱う二つだけに切り分ける。 */
  readWebhook(body: string, signature: string): WebhookEvent;
}

/* --------------------------------------------------------------------------
   本物
   -------------------------------------------------------------------------- */

const stripe = lazy(() => new Stripe(env.STRIPE_SECRET_KEY ?? ''));

const realGateway: BillingGateway = {
  async ensureCustomer({ name, email, existing }) {
    if (existing) {
      return existing;
    }
    const customer = await stripe.customers.create({ name, email });
    return customer.id;
  },

  async setupUrl({ customerId, successUrl, cancelUrl }) {
    /*
     * Managed Payments が既定で有効なアカウントでは、mode: 'setup' が弾かれる。
     * 受け付けるのは payment か subscription だけだと言ってくる。
     *
     * どちらにも寄せられない。ここで課金はしないので payment ではなく、
     * サブスクリプションも使っていない。預かるのはカードだけである。
     * そのためリクエストごとに切る。
     *
     * アカウントの設定でも既定を切れるが、そちらに頼らない。
     * 設定が戻された日に、支払いの入口だけが黙って壊れる。
     *
     * SDK 22.6.2 の型にまだ無いので、この一つだけ足した型で受ける。
     */
    const params: Stripe.Checkout.SessionCreateParams & {
      managed_payments?: { enabled: boolean };
    } = {
      mode: 'setup',
      customer: customerId,
      currency: CURRENCY,
      /*
       * 税の計算には要らないが、請求書の宛先として集める。
       * カード会社の不正検知にも効く。
       */
      billing_address_collection: 'required',
      customer_update: { address: 'auto', name: 'auto' },
      success_url: successUrl,
      cancel_url: cancelUrl,
      managed_payments: { enabled: false },
    };

    const session = await stripe.checkout.sessions.create(params);
    if (!session.url) {
      throw new Error('Checkout の URL が返りませんでした');
    }
    return session.url;
  },

  async portalUrl({ customerId, returnUrl }) {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return session.url;
  },

  async confirmPaymentMethod(customerId) {
    const methods = await stripe.paymentMethods.list({ customer: customerId, limit: 1 });
    const method = methods.data[0];
    if (!method) {
      return false;
    }
    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: method.id },
    });
    return true;
  },

  /*
   * 冪等キーは請求の行の id から作る（呼ぶ側が渡す）。
   * Stripe はキーを24時間覚えているので、同じ行で作り直すと
   * 前回と同じ請求書が返る。渡した内容を変えても返ってくるものは変わらない。
   *
   * つまり、間違った内容で作ってしまった請求書は、その行では直せない。
   * 直し方は行ごと作り直すことである（新しい id が新しいキーになる）。
   * 手順は docs/features/billing/index.html の「詰まった請求を作り直す」にある。
   */
  async issueInvoice({ customerId, billingMonth, memberCount, subtotal, idempotencyKey }) {
    const label = `${formatBillingMonth(billingMonth)} 利用料（${memberCount}人 × ${formatMoney(UNIT_PRICE)}）`;

    const draft = await stripe.invoices.create(
      {
        customer: customerId,
        /*
         * 通貨をここでも渡す。渡さないとアカウントの既定（日本のアカウントなら JPY）で
         * 請求書ができ、あとから入れる USD の明細と食い違って弾かれる。
         * 明細側にだけ書いてあれば足りる、とはならない。
         */
        currency: CURRENCY,
        collection_method: 'charge_automatically',
        // 決済はこちらから一度だけ試す。Stripe の自動再試行に任せない
        auto_advance: false,
        /*
         * 税額の計算を任せない。適格請求書発行事業者の登録をしていないので、
         * 税を別記した請求書を出さない。単価そのものが税込である。
         */
        automatic_tax: { enabled: false },
        description: label,
      },
      { idempotencyKey: `${idempotencyKey}:invoice` },
    );
    if (!draft.id) {
      throw new Error('請求書の id が返りませんでした');
    }

    await stripe.invoiceItems.create(
      {
        customer: customerId,
        invoice: draft.id,
        currency: CURRENCY,
        // 税込の総額をそのまま渡す。Stripe が足すものは無い
        amount: subtotal,
        description: label,
      },
      { idempotencyKey: `${idempotencyKey}:item` },
    );

    const finalized = await stripe.invoices.finalizeInvoice(draft.id);
    return {
      id: finalized.id ?? draft.id,
      pdfUrl: finalized.invoice_pdf ?? null,
      // 税を別に取らないので、ここは常に空になる
      tax: null,
      total: finalized.total ?? null,
    };
  },

  async payInvoice(stripeInvoiceId) {
    try {
      const paid = await stripe.invoices.pay(stripeInvoiceId);
      return paid.status === 'paid';
    } catch (err) {
      /*
       * カードが通らなかった。ここで投げると巡回が倒れるので偽を返す。
       * ただし理由は残す。握りつぶすと、凍結された組織を前にして
       * 「カードが悪いのか、こちらの作りが悪いのか」を本番で切り分けられない。
       */
      const detail =
        err instanceof Stripe.errors.StripeError
          ? { code: err.code, declineCode: err.decline_code, message: err.message }
          : err;
      console.warn(`[billing] 決済が通りませんでした（${stripeInvoiceId}）`, detail);
      return false;
    }
  },

  readWebhook(body, signature) {
    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      env.STRIPE_WEBHOOK_SECRET ?? '',
    );
    if (event.type === 'invoice.paid') {
      return { kind: 'paid', stripeInvoiceId: (event.data.object as Stripe.Invoice).id ?? '' };
    }
    if (event.type === 'invoice.payment_failed') {
      return {
        kind: 'failed',
        stripeInvoiceId: (event.data.object as Stripe.Invoice).id ?? '',
      };
    }
    return { kind: 'ignored' };
  },
};

/* --------------------------------------------------------------------------
   偽物

   ブラウザ試験のために置く。外へ出ていかない。
   凍結された組織で投稿欄が消えていることは、実際に描画しないと確かめられない。
   -------------------------------------------------------------------------- */

const fakeGateway: BillingGateway = {
  /*
   * 連番にしない。プロセスを起こし直すたびに 1 から振り直され、
   * 前の回が残した行と一意索引でぶつかる。
   * 実際にぶつかって、支払いの画面が 500 を返した。
   */
  async ensureCustomer({ existing }) {
    return existing ?? `cus_fake_${randomUUID()}`;
  },

  // 押したその場で戻ってくる。Stripe の画面を挟まない
  async setupUrl({ successUrl }) {
    return successUrl;
  },

  async portalUrl({ returnUrl }) {
    return returnUrl;
  },

  async confirmPaymentMethod() {
    return true;
  },

  async issueInvoice({ subtotal, idempotencyKey }) {
    return {
      id: `in_fake_${idempotencyKey}`,
      pdfUrl: null,
      tax: null,
      total: subtotal,
    };
  },

  async payInvoice() {
    return true;
  },

  readWebhook() {
    return { kind: 'ignored' };
  },
};

/* --------------------------------------------------------------------------
   選ぶ
   -------------------------------------------------------------------------- */

const offGateway: BillingGateway = new Proxy({} as BillingGateway, {
  get(_target, name) {
    return () => {
      throw new Error(
        `BILLING_MODE=off のときに決済代行が呼ばれました: ${String(name)}。` +
          '課金の画面は 404 を返すはずです',
      );
    };
  },
});

export function gateway(): BillingGateway {
  switch (env.BILLING_MODE) {
    case 'stripe':
      return realGateway;
    case 'fake':
      return fakeGateway;
    default:
      return offGateway;
  }
}
