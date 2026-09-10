import Link from 'next/link';
import { billingPath } from './path.ts';
import { formatDay } from './plan.ts';

/*
 * 凍結中に、すべての画面の上へ出す帯。
 *
 * 新しい CSS を持たない。画面の中の短い知らせには .app-note がすでにある。
 * 使う class を増やさなければ、@shared に足す手順も要らない。
 *
 * 出す文言は役割で変える。
 * 支払いに進めるのは組織管理者だけなので、それ以外の人に押しボタンを見せない。
 * 押せない押しボタンを見せない、という画面の方針に従う。
 */

export function FrozenBanner({
  slug,
  isOrgAdmin,
  reason,
  onBillingPage,
}: {
  slug: string;
  isOrgAdmin: boolean;
  /** 支払いの画面そのものでは、同じ場所への押しボタンを繰り返さない。 */
  onBillingPage: boolean;
  /** 凍結の理由。おためし切れなら期限の日、未払いなら対象月。 */
  reason: { kind: 'trial'; trialEndsOn: string } | { kind: 'unpaid' } | null;
}) {
  return (
    <div className="app-note warn">
      <p style={{ margin: 0 }}>
        <strong>この組織は凍結されています。</strong>{' '}
        {reason?.kind === 'trial'
          ? `おためし期間が ${formatDay(reason.trialEndsOn)} に終わりました。`
          : reason?.kind === 'unpaid'
            ? 'お支払いが確認できませんでした。'
            : null}{' '}
        閲覧と添付のダウンロードは、これまでどおり行えます。
      </p>
      <p style={{ margin: '.6rem 0 0' }}>
        {isOrgAdmin && onBillingPage ? (
          '下の欄から支払い方法を登録すると、その場で書き込みが元に戻ります。'
        ) : isOrgAdmin ? (
          <Link className="app-btn" href={billingPath(slug)} style={{ textDecoration: 'none' }}>
            支払いの手続きへ
          </Link>
        ) : (
          '書き込みができるのは、支払いの手続きが済んでからです。組織管理者にご連絡ください。'
        )}
      </p>
    </div>
  );
}
