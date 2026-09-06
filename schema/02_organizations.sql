-- テナントの境界。すべてのデータがこの下に入る。
-- スレッド番号の採番元でもある（next_thread_number）。
CREATE TABLE organizations (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text        NOT NULL,
  slug               text        NOT NULL,
  language           text        NOT NULL DEFAULT 'ja',
  timezone           text        NOT NULL DEFAULT 'Asia/Tokyo',
  next_thread_number integer     NOT NULL DEFAULT 1,
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
    CHECK (next_thread_number >= 1)
);

CREATE UNIQUE INDEX organizations_slug_key
  ON organizations (slug) WHERE deleted_at IS NULL;

