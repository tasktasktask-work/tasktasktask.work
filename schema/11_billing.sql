-- 月ごとの請求。組織ひとつ、ひと月ぶんで一行。
--
-- 課金人数は organization_members から後追いで計算できる。
-- それでも計算し直さない。計算し直す作りにすると、確定した請求の正しさが
-- 「過去の行が二度と動かないこと」に依存してしまう。
-- 数えた時点の結果をここに固定し、以後は読むだけにする。
--
-- 仕様は docs/features/billing/index.html にある。
CREATE TABLE billing_invoices (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid        NOT NULL REFERENCES organizations(id),

  -- 課金対象月。月そのものを表す型が無いので、月初の日付で持つ。
  billing_month      date        NOT NULL,

  member_count       integer     NOT NULL,
  unit_price         integer     NOT NULL,
  subtotal           integer     NOT NULL,

  -- 消費税と税込合計は Stripe Tax が計算する。確定してから書き戻す。
  tax_amount         integer,
  total_amount       integer,

  status             text        NOT NULL DEFAULT 'pending',
  stripe_invoice_id  text,
  invoice_pdf_url    text,
  paid_at            timestamptz,
  failed_at          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT billing_invoices_first_of_month
    CHECK (extract(day from billing_month) = 1),

  -- 最後の組織管理者を外せないので、在籍者が 0 になることはない。
  CONSTRAINT billing_invoices_member_count_positive
    CHECK (member_count >= 1),

  CONSTRAINT billing_invoices_unit_price_positive
    CHECK (unit_price >= 1),

  -- 単価を変えても、過去の明細が自分で辻褄を持つ。
  CONSTRAINT billing_invoices_subtotal_matches
    CHECK (subtotal = member_count * unit_price),

  -- pending は「行はできたが Stripe の請求書がまだ無い」状態。
  -- 途中で落ちたときにここへ残り、次の巡回が続きから進める。
  CONSTRAINT billing_invoices_status_valid
    CHECK (status IN ('pending', 'open', 'paid', 'unpaid')),

  CONSTRAINT billing_invoices_open_has_stripe
    CHECK (status = 'pending' OR stripe_invoice_id IS NOT NULL),

  CONSTRAINT billing_invoices_paid_has_time
    CHECK ((status = 'paid') = (paid_at IS NOT NULL))
);

-- 同じ月を二度請求しない。請求処理の冪等性はここが担保する。
CREATE UNIQUE INDEX billing_invoices_month_key
  ON billing_invoices (organization_id, billing_month);

-- 凍結の判定が毎リクエスト走る。未払いの有無だけを引く。
CREATE INDEX billing_invoices_unpaid
  ON billing_invoices (organization_id) WHERE status = 'unpaid';

CREATE UNIQUE INDEX billing_invoices_stripe_key
  ON billing_invoices (stripe_invoice_id) WHERE stripe_invoice_id IS NOT NULL;


-- 請求のときに数えた人。「この金額は誰の分か」に答えるためだけの行。
--
-- 表示名まで焼くのは、人が名前を変えるからである。
-- user_id だけを残すと、あとで明細を開いたときに当時と違う名前が並ぶ。
CREATE TABLE billing_invoice_members (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_invoice_id uuid        NOT NULL REFERENCES billing_invoices(id),
  user_id            uuid        NOT NULL REFERENCES users(id),
  display_name       text        NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT billing_invoice_members_name_not_blank
    CHECK (btrim(display_name) <> '')
);

-- 書いたあと二度と変えない行なので、updated_at を持たない。
-- 更新の時刻を持たせると、更新しうるように読めてしまう。

-- 同じ人を二度数えない。
-- 抜けてから招待し直された人は organization_members に行を二つ持つ
-- （acceptInvitation が畳んだ行を起こさず、新しい行を足すため）。
CREATE UNIQUE INDEX billing_invoice_members_uniq
  ON billing_invoice_members (billing_invoice_id, user_id);
