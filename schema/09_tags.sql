-- 階層と直交する分類の軸。組織の単位で定義し、プロジェクトをまたいで使う。
CREATE TABLE tags (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id),
  name            text        NOT NULL,
  color           text        NOT NULL DEFAULT '#7d8792',
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tags_name_not_blank
    CHECK (btrim(name) <> '' AND length(name) <= 40),
  CONSTRAINT tags_color_format
    CHECK (color ~ '^#[0-9a-f]{6}$')
);

CREATE UNIQUE INDEX tags_name_uniq
  ON tags (organization_id, lower(name)) WHERE deleted_at IS NULL;



-- 中間テーブル。付け外しが日常的に起きるため物理削除とする。
-- 「すべてのレコードは論理削除」という方針からの、承認された例外である。
CREATE TABLE thread_tags (
  thread_id  uuid        NOT NULL REFERENCES threads(id),
  tag_id     uuid        NOT NULL REFERENCES tags(id),
  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (thread_id, tag_id)
);

CREATE INDEX thread_tags_by_tag ON thread_tags (tag_id);
