import type { Metadata } from 'next';
import { PublicPage, Todo } from '#features/public/PublicPage.tsx';

export const metadata: Metadata = { title: 'プライバシーポリシー' };

/*
 * プライバシーポリシー。
 *
 * 書いてあることは、実際に流れているものと揃えてある。
 * 取得していない情報を「取得します」と書かない。
 * 送っていない先を「送ります」と書かない。
 *
 * 事実の裏は次のとおり。
 *   Cookie は task3_session のひとつだけ（src/features/authentication/cookie.ts）
 *   解析や広告の道具は入っていない
 *   外へ出ていく通信は、書体の配信と、メールの送信と、決済代行だけ
 *   添付ファイルはサーバーのディスクに置く（ATTACHMENTS_DIR）
 *   パスワードは argon2 で変換して保存する
 */
export default function PrivacyPage() {
  return (
    <PublicPage
      title="プライバシーポリシー"
      lede="TASK3 で取り扱う個人情報について、取得するもの、使う目的、預ける先を記載します。"
      revised={<Todo>公開日を記入してください</Todo>}
    >
      <h2>1. 取得する情報</h2>

      <h3>ご登録いただくもの</h3>
      <ul>
        <li>メールアドレス（ログインと通知に使います）</li>
        <li>表示名</li>
        <li>
          パスワード（設定された場合のみ。そのままの形では保存せず、復元できない形に変換して保存します）
        </li>
      </ul>

      <h3>ご利用に伴って記録されるもの</h3>
      <ul>
        <li>本サービスへ登録された文章、コメント、添付ファイル、およびそれらの作成者と日時</li>
        <li>ログインの状態を保つための情報（後述の Cookie）</li>
        <li>サーバーの動作記録（接続元の IP アドレス、日時、リクエストの内容）</li>
      </ul>

      <h3>取得していないもの</h3>
      <p>
        <strong>クレジットカードの番号は取得していません。</strong>
        カード情報の入力は決済代行事業者の画面で行われ、当社のサーバーを通りません。
      </p>
      <p>
        行動を追跡する目的の Cookie、アクセス解析、広告の配信に関わる仕組みは使用していません。
      </p>

      <h2>2. 利用の目的</h2>
      <ul>
        <li>本サービスの提供、および本人確認</li>
        <li>通知メールの送信</li>
        <li>利用料金の請求</li>
        <li>不具合の調査、および不正な利用への対応</li>
        <li>本サービスに関する重要なお知らせの連絡</li>
      </ul>
      <p>上記以外の目的には使用しません。</p>

      <h2>3. Cookie</h2>
      <p>
        ログインの状態を保つために、Cookie をひとつだけ使用します。 この Cookie
        にはログインを識別する値のみが入っており、氏名やメールアドレスは含まれません。
        ログアウトすると無効になります。
      </p>
      <p>ブラウザの設定で Cookie を拒否された場合、ログインができなくなります。</p>

      <h2>4. 第三者への提供と、業務の委託先</h2>
      <p>
        法令に基づく場合を除き、ご本人の同意なく第三者へ個人情報を提供することはありません。
        ただし、本サービスの提供に必要な範囲で、次の事業者へ取り扱いを委託しています。
      </p>

      <div className="app-props">
        <div className="row">
          <span className="k" style={{ width: '9rem' }}>
            決済
          </span>
          <span className="v">
            Stripe, Inc. — カード情報、請求先の氏名・住所、メールアドレス
          </span>
        </div>
        <div className="row">
          <span className="k" style={{ width: '9rem' }}>
            メール送信
          </span>
          <span className="v">Cloudflare, Inc. — 宛先のメールアドレス、本文</span>
        </div>
        <div className="row">
          <span className="k" style={{ width: '9rem' }}>
            サーバー
          </span>
          <span className="v">
            <Todo>利用しているサーバー事業者名を記入してください</Todo> — 本サービスのデータ全般
          </span>
        </div>
        <div className="row">
          <span className="k" style={{ width: '9rem' }}>
            書体の配信
          </span>
          <span className="v">
            Google LLC — 画面を表示する際に、閲覧しているブラウザから同社へ接続します
          </span>
        </div>
      </div>

      <p>
        これらの事業者は日本国外にサーバーを置いている場合があります。
        いずれも、委託した範囲を超えて情報を利用することはありません。
      </p>

      <h2>5. 組織の中での見え方</h2>
      <p>
        本サービスは組織を単位として提供します。
        組織に登録された文章、コメント、添付ファイルは、その組織に所属する方が閲覧できます。
        組織をまたいで内容が見えることはありません。
      </p>
      <p>
        メールアドレスは、組織の管理者にのみ表示されます。それ以外の方には表示名のみが表示されます。
      </p>

      <h2>6. 保存する期間</h2>
      <p>
        本サービスをご利用いただいているあいだ保存します。
        お支払いが確認できず書き込みを停止した場合も、データは削除しません。
      </p>
      <p>
        削除をご希望の場合は、下記の窓口へご連絡ください。
        なお、法令により保存が義務づけられている記録については、その期間保存します。
      </p>

      <h2>7. 安全のための措置</h2>
      <ul>
        <li>通信はすべて暗号化します</li>
        <li>パスワードは復元できない形に変換して保存します</li>
        <li>データへの接触は、本サービスの運営に必要な者に限ります</li>
      </ul>

      <h2>8. 開示・訂正・削除のご請求</h2>
      <p>
        ご本人からの求めに応じ、保有する個人情報の開示、訂正、利用の停止、および削除を行います。
        下記の窓口へご連絡ください。ご本人であることを確認したうえで、遅滞なく対応します。
      </p>

      <h2>9. 本ポリシーの変更</h2>
      <p>
        必要に応じて本ポリシーを変更することがあります。
        変更する場合は、本ページに変更後の内容と適用日を掲示します。
      </p>

      <h2>10. お問い合わせ窓口</h2>
      <div className="app-props">
        <div className="row">
          <span className="k" style={{ width: '9rem' }}>
            事業者名
          </span>
          <span className="v">
            <Todo>事業者名を記入してください</Todo>
          </span>
        </div>
        <div className="row">
          <span className="k" style={{ width: '9rem' }}>
            連絡先
          </span>
          <span className="v">
            <Todo>メールアドレスを記入してください</Todo>
          </span>
        </div>
      </div>
    </PublicPage>
  );
}
