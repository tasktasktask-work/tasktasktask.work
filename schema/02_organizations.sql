-- テナントの境界。すべてのデータがこの下に入る。
-- スレッド番号の採番元でもある（next_thread_number）。
CREATE TABLE organizations (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text        NOT NULL,
  slug               text        NOT NULL,
  language           text        NOT NULL DEFAULT 'ja',
  timezone           text        NOT NULL DEFAULT 'Asia/Tokyo',
  next_thread_number integer     NOT NULL DEFAULT 1,

  -- 課金 ------------------------------------------------------------------
  -- おためし期間の最終日。この日までは支払い方法が無くても書き込める。
  --
  -- 既定値が「今日の属する月の翌月末」を返すので、
  -- 列を足す移行がそのまま既存組織への付与になる。
  -- created_at を起点にすると、移行を当てた瞬間に全組織が凍結する。
  --
  -- タイムゾーンを組織ごとの timezone にできない（自分の行の他の列を
  -- 既定値の式から参照できない）。請求を事業者側の暦で切ると決めたので、
  -- ここも日本標準時に固定する。
  trial_ends_on      date        NOT NULL DEFAULT
    ((date_trunc('month', now() AT TIME ZONE 'Asia/Tokyo')
      + interval '2 month' - interval '1 day')::date),

  -- 請求も凍結も行わない。社内の組織、デモ、支払いの取り決めが特殊な相手。
  billing_exempt        boolean     NOT NULL DEFAULT false,

  stripe_customer_id    text,

  -- 支払い方法を預かった時刻。NULL なら未登録。
  payment_method_set_at timestamptz,

  -- おためし終了の知らせをどこまで送ったか。0=未送信 1=7日前 2=前日 3=凍結。
  -- 単調に増えるだけなので、送信済みの記録に別のテーブルを立てずに済む。
  billing_notice_stage  smallint    NOT NULL DEFAULT 0,

  deleted_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT organizations_name_not_blank
    CHECK (btrim(name) <> ''),

  -- 小文字と数字とハイフンのみ。先頭と末尾はハイフンにできない。
  -- 小文字しか入らないため、大文字小文字を区別しない比較は不要になる。
  CONSTRAINT organizations_slug_format
    CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),

  -- 対応言語を増やすときに、この制約も一緒に更新することを強制する。
  CONSTRAINT organizations_language_supported
    CHECK (language IN ('ja')),

  CONSTRAINT organizations_next_number_positive
    CHECK (next_thread_number >= 1),

  CONSTRAINT organizations_notice_stage_range
    CHECK (billing_notice_stage BETWEEN 0 AND 3)
);

CREATE UNIQUE INDEX organizations_slug_key
  ON organizations (slug) WHERE deleted_at IS NULL;

-- ひとつの Stripe 顧客が二つの組織に結びつかないようにする。
CREATE UNIQUE INDEX organizations_stripe_customer_key
  ON organizations (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

