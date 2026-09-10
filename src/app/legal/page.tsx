import type { Metadata } from 'next';
import { formatMoney, UNIT_PRICE } from '#features/billing/plan.ts';
import { BUSINESS, ON_REQUEST } from '#features/public/business.ts';
import { Fact, PublicPage } from '#features/public/PublicPage.tsx';

export const metadata: Metadata = { title: '特定商取引法に基づく表記' };

/*
 * 日本から有料のサービスを売るために要る表記。
 *
 * 運営統括責任者・所在地・電話番号は広告に載せず、請求があれば開示する扱いにしている。
 * そのぶん、請求を受ける窓口（事業者名と連絡先）は必ず出す。
 * 窓口が無いと「請求により開示」が仕組みとして成り立たない。
 *
 * 値は #features/public/business.ts にまとめてある。
 */
export default function LegalPage() {
  return (
    <PublicPage
      title="特定商取引法に基づく表記"
      lede="特定商取引法第11条（通信販売についての広告）に基づき、以下のとおり表示します。"
    >
      <div className="app-props">
        <Row k="販売事業者">
          <Fact value={BUSINESS.name} label="事業者名" />
        </Row>
        <Row k="運営統括責任者">{ON_REQUEST}</Row>
        <Row k="所在地">{ON_REQUEST}</Row>
        <Row k="電話番号">{ON_REQUEST}</Row>
        <Row k="連絡先">
          <Fact value={BUSINESS.email} label="メールアドレス" />
        </Row>
        <Row k="販売価格">1人あたり 1ヶ月 {formatMoney(UNIT_PRICE)}（税込）</Row>
        <Row k="対価以外に必要な費用">
          インターネット接続に必要な通信料。価格が米ドル建てのため、日本国内で発行されたカードで
          お支払いの場合は、カード会社所定の事務手数料および換算レートにより、請求額が変動します
        </Row>
        <Row k="支払方法">クレジットカード</Row>
        <Row k="支払時期">月末で人数を確定し、翌月1日に決済します。前払いはありません</Row>
        <Row k="役務の提供時期">お申し込み後、ただちにご利用いただけます</Row>
        <Row k="返品・キャンセル">
          後払いのため、前払いいただいた対価の返金は発生しません。解約のお手続きは不要で、
          ご利用をやめていただければ翌月以降の請求は行いません
        </Row>
        <Row k="動作環境">最新版の Google Chrome、Microsoft Edge、Safari、Firefox</Row>
      </div>

      <h2>請求による開示について</h2>

      <p>
        運営統括責任者の氏名、所在地、および電話番号は、上記の連絡先へご請求いただければ、
        遅滞なく書面または電子メールにて開示します。
      </p>

      <h2>無料でお試しいただける期間</h2>

      <p>
        新しく作られた組織は、作成日から翌月末まで無料でご利用いただけます。
        この期間中に料金は発生しません。詳しくは<a href="/pricing">料金</a>をご覧ください。
      </p>

      <h2>消費税について</h2>

      <p>
        表示価格は税込です。当社は適格請求書発行事業者の登録を行っていないため、
        適格請求書（インボイス）の発行はできません。
      </p>
    </PublicPage>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="row">
      <span className="k" style={{ width: '10rem' }}>
        {k}
      </span>
      <span className="v">{children}</span>
    </div>
  );
}
