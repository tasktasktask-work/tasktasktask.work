-- アカウント。組織には属さない。
-- ひとりが複数の組織に所属するため、所属関係は organization_members が持つ。
CREATE TABLE users (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 小文字で正規化して保存する。citext を使わないのは、
  -- 拡張をひとつ増やす価値がないため（詳細は下の CHECK 制約）。
  email                       text        NOT NULL,
  display_name                text        NOT NULL,

  -- マジックリンクだけを使う人がありうるため NULL を許す。
  password_hash               text,

  -- 連続失敗回数。成功で 0 に戻す。
  failed_login_count          smallint    NOT NULL DEFAULT 0,

  -- ロックの時刻。時間経過では解除しない。
  -- マジックリンクでのログイン成功時にリセットする。
  locked_at                   timestamptz,

  email_notifications_enabled boolean     NOT NULL DEFAULT true,
  deleted_at                  timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  -- 大文字小文字を区別しない比較は、値を小文字に揃えることで不要にする。
  -- 書き込む側が lower() を忘れたら、ここで落ちる。
  CONSTRAINT users_email_lowercase
    CHECK (email = lower(email)),
  CONSTRAINT users_email_shape
    CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  CONSTRAINT users_display_name_not_blank
    CHECK (btrim(display_name) <> ''),
  CONSTRAINT users_failed_login_count_range
    CHECK (failed_login_count BETWEEN 0 AND 10)
);

CREATE UNIQUE INDEX users_email_key
  ON users (email) WHERE deleted_at IS NULL;

