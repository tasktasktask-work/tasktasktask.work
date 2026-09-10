import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LoginScreen } from '#features/authentication/LoginScreen.tsx';
import { completeCheckout } from '#features/billing/actions.ts';
import { PortalButton, RegisterButton } from '#features/billing/BillingButtons.tsx';
import { formatBillingMonth, formatDay, formatMoney } from '#features/billing/plan.ts';
import {
  getBillingStatus,
  type InvoiceRow,
  listInvoiceMembers,
  listInvoices,
} from '#features/billing/queries.ts';
import { OrgShell } from '#features/organization/OrgShell.tsx';
import { getOrganization } from '#features/organization/queries.ts';
import { currentScope } from '#features/organization/scope.ts';
import { listProjectLinks } from '#features/project/queries.ts';
import { env } from '#lib/env.ts';

export const metadata: Metadata = { title: '支払いと請求' };

/*
 * 支払いと請求。
 *
 * 触れるのは組織管理者だけなので、メンバーには 404 を返す。
 * 組織の設定と同じ扱いである。
 *
 * 凍結中でも開ける。ここが開かないと、凍結が解けない。
 */
export default async function BillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ checkout?: string }>;
}) {
  // 課金を動かしていない環境では、この画面そのものが無い
  if (env.BILLING_MODE === 'off') {
    notFound();
  }

  const { slug } = await params;
  const found = await currentScope(slug);
  if (!found.ok) {
    return found.anonymous ? <LoginScreen /> : notFound();
  }
  if (!found.scope.isOrgAdmin) {
    notFound();
  }

  /*
   * Checkout から戻ったところ。登録できたかを決済代行に確かめる。
   * 未払いが残っていれば、続けてその決済を試す。
   */
  const { checkout } = await searchParams;
  const outcome = checkout === 'done' ? await completeCheckout(slug) : null;

  const [organization, links, status, invoices] = await Promise.all([
    getOrganization(found.scope),
    listProjectLinks(found.scope),
    getBillingStatus(found.scope),
    listInvoices(found.scope),
  ]);
  if (!status) {
    notFound();
  }

  return (
    <OrgShell
      slug={slug}
      organizationName={organization.name}
      displayName={found.user.displayName}
      scope={found.scope}
      current="billing"
      projects={links}
    >
      <div className="app-head">
        <div>
          <h2>支払いと請求</h2>
          <div className="sub">開けるのは組織管理者だけです</div>
        </div>
      </div>

      {outcome === 'done' ? (
        <div className="app-note ok">
          <p style={{ margin: 0 }}>支払い方法を登録しました。</p>
        </div>
      ) : null}
      {outcome === 'unpaid' ? (
        <div className="app-note warn">
          <p style={{ margin: 0 }}>
            未払いぶんの決済が通りませんでした。別のカードをお試しください。
          </p>
        </div>
      ) : null}
      {outcome === 'failed' ? (
        <div className="app-note warn">
          <p style={{ margin: 0 }}>支払い方法を確認できませんでした。</p>
        </div>
      ) : null}
      {checkout === 'cancel' ? (
        <div className="app-note">
          <p style={{ margin: 0 }}>登録をやめました。組織はいまの状態のままです。</p>
        </div>
      ) : null}

      <div className="app-props" style={{ maxWidth: '34rem' }}>
        <div className="row">
          <span className="k">状態</span>
          <span className="v">
            <StateBadge status={status} />
            {status.state === 'frozen'
              ? status.unpaid
                ? ' 未払いが 1 件あります'
                : ' 支払い方法が未登録です'
              : null}
          </span>
        </div>

        {status.state === 'trialing' ? (
          <div className="row">
            <span className="k">期限</span>
            <span className="v">{formatDay(status.trialEndsOn)}</span>
          </div>
        ) : null}

        {status.state === 'frozen' && status.unpaid ? (
          <div className="row">
            <span className="k">未払い</span>
            <span className="v">
              {formatBillingMonth(status.unpaid.billingMonth)}分
              {status.unpaid.totalAmount === null
                ? null
                : ` · ${formatMoney(status.unpaid.totalAmount)}`}
            </span>
          </div>
        ) : null}

        <div className="row">
          <span className="k">人数</span>
          <span className="v">{status.memberCount} 人</span>
        </div>
        <div className="row">
          <span className="k">単価</span>
          <span className="v">{formatMoney(status.unitPrice)} / 人 / 月（税込）</span>
        </div>
        <div className="row">
          <span className="k">今月</span>
          <span className="v">
            {status.memberCount} 人 × {formatMoney(status.unitPrice)} ={' '}
            {formatMoney(status.subtotalNow)}（税込）
          </span>
        </div>
        <div className="row">
          <span className="k">請求</span>
          <span className="v">
            {status.currentMonth < status.firstBillingMonth
              ? `${formatBillingMonth(status.firstBillingMonth)}分から`
              : `${formatBillingMonth(status.currentMonth)}分を翌月1日に`}
          </span>
        </div>
      </div>

      <Guidance status={status} />

      <div style={{ marginBottom: '1.4rem' }}>
        {status.paymentMethodSet && status.state !== 'frozen' ? (
          <PortalButton slug={slug} />
        ) : (
          <RegisterButton
            slug={slug}
            label={
              status.unpaid
                ? 'カードを登録して未払いを支払う'
                : status.state === 'frozen'
                  ? '支払い方法を登録して再開する'
                  : '支払い方法を登録する'
            }
          />
        )}
      </div>

      <h4 className="app-section">請求の記録</h4>
      {invoices.length === 0 ? (
        <div className="app-empty">請求の記録はまだありません</div>
      ) : (
        <div className="app-people">
          {invoices.map((invoice) => (
            <InvoiceLine
              key={invoice.id}
              invoice={invoice}
              slug={slug}
              scopeUserId={found.scope}
            />
          ))}
        </div>
      )}
    </OrgShell>
  );
}

function StateBadge({
  status,
}: {
  status: { state: string; trialEndsOn: string; today: string };
}) {
  if (status.state === 'trialing') {
    const days = daysBetween(status.today, status.trialEndsOn);
    return (
      <>
        <span className="badge ai">おためし中</span> 残り {days} 日
      </>
    );
  }
  if (status.state === 'active') {
    return <span className="badge midori">有効</span>;
  }
  if (status.state === 'exempt') {
    return <span className="badge mute">課金免除</span>;
  }
  return <span className="badge shu">凍結</span>;
}

function daysBetween(from: string, to: string): number {
  const day = 86_400_000;
  return Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / day));
}

function Guidance({
  status,
}: {
  status: { state: string; firstBillingMonth: string; unpaid: InvoiceRow | null };
}) {
  if (status.state === 'trialing') {
    return (
      <div className="app-note">
        <p style={{ margin: 0 }}>
          いま支払い方法を登録しても、課金の開始は早まりません。 最初に請求するのは
          {formatBillingMonth(status.firstBillingMonth)}分です。
        </p>
      </div>
    );
  }
  if (status.state === 'frozen' && status.unpaid) {
    return (
      <div className="app-note">
        <p style={{ margin: 0 }}>
          新しいカードを登録すると、まず未払いのぶんを決済します。
          通れば、その場で書き込みが元に戻ります。
        </p>
      </div>
    );
  }
  if (status.state === 'active') {
    return (
      <div className="app-note">
        <p style={{ margin: 0 }}>
          今月の人数は、月が終わるまで動きます。
          月の途中で入った人も、抜けた人も、その月はまるごと数えます。
        </p>
      </div>
    );
  }
  return null;
}

async function InvoiceLine({
  invoice,
  scopeUserId,
}: {
  invoice: InvoiceRow;
  slug: string;
  scopeUserId: Parameters<typeof listInvoiceMembers>[0];
}) {
  const members = await listInvoiceMembers(scopeUserId, invoice.id);

  return (
    <div className={invoice.status === 'unpaid' ? 'app-person app-pending' : 'app-person'}>
      <span className="who">
        <span className="nm">{formatBillingMonth(invoice.billingMonth)}分</span>
        <span className="ad">
          {invoice.memberCount} 人 × {formatMoney(invoice.unitPrice)}
          {invoice.totalAmount === null ? null : ` · ${formatMoney(invoice.totalAmount)}`}
        </span>
        <details className="app-disclosure" style={{ marginBottom: 0, marginTop: '.4rem' }}>
          <summary>数えた {members.length} 人</summary>
          <span className="ad" style={{ whiteSpace: 'normal' }}>
            {members.map((member) => member.displayName).join('、')}
          </span>
        </details>
      </span>
      <span className="app-role" data-role={invoice.status === 'unpaid' ? 'admin' : undefined}>
        {invoice.status === 'paid'
          ? '支払い済み'
          : invoice.status === 'unpaid'
            ? '未払い'
            : '請求中'}
      </span>
      {invoice.invoicePdfUrl ? (
        <a className="app-btn ghost" href={invoice.invoicePdfUrl} rel="noreferrer noopener">
          請求書 PDF
        </a>
      ) : null}
    </div>
  );
}
