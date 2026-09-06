-- スレッドに時系列で連なる発言。枝分かれしない。
--
-- 投稿後に更新される経路が存在しないため、updated_at を持たない。
-- 列がないこと自体が「編集できない」という仕様の表明である。
CREATE TABLE comments (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id),
  thread_id       uuid        NOT NULL REFERENCES threads(id),
  author_user_id  uuid        NOT NULL REFERENCES users(id),
  body            text        NOT NULL,

  -- 本人による削除はできない。組織管理者による論理削除のみ。
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT comments_body_not_blank
    CHECK (btrim(body) <> '')
);

CREATE INDEX comments_by_thread
  ON comments (thread_id, created_at) WHERE deleted_at IS NULL;


-- スレッドかコメントのどちらか一方に付く。
-- 実体はファイルシステム側にあり、ここが持つのは在り処と元の名前である。
CREATE TABLE attachments (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid        NOT NULL REFERENCES organizations(id),
  thread_id           uuid        REFERENCES threads(id),
  comment_id          uuid        REFERENCES comments(id),

  -- 生成した値。利用者の入力を含まない。
  storage_key         text        NOT NULL,

  -- 表示用。パスには使わない。画面に出すときはエスケープする。
  original_filename   text        NOT NULL,

  byte_size           bigint      NOT NULL,

  -- ブラウザが申告した MIME タイプ。記録のみで、配信には使わない。
  declared_type       text,

  -- サーバー側の再エンコードに成功したか。真ならインライン表示する。
  -- 形式のホワイトリストは持たない。デコーダそのものが判定器である。
  is_image            boolean     NOT NULL DEFAULT false,

  uploaded_by_user_id uuid        NOT NULL REFERENCES users(id),
  deleted_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT attachments_exactly_one_owner
    CHECK ((thread_id IS NULL) <> (comment_id IS NULL)),

  CONSTRAINT attachments_size_limit
    CHECK (byte_size > 0 AND byte_size <= 10 * 1024 * 1024)
);

CREATE UNIQUE INDEX attachments_storage_key_uniq ON attachments (storage_key);
CREATE INDEX attachments_by_thread  ON attachments (thread_id)  WHERE deleted_at IS NULL;
CREATE INDEX attachments_by_comment ON attachments (comment_id) WHERE deleted_at IS NULL;
