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


-- コメントの中のチェックボックスの状態。
--
-- 本文とは別に持つ。本文を書き換えないためである。
-- comments は投稿後に更新されない（updated_at を持たないのはその表明である）。
-- チェックを入れるために本文を書き換えると、その約束が崩れる。
--
-- position は本文の中で何番目のチェックボックスか（0 始まり）。
-- 本文が書き換わらないので、この番号は永久に同じ箱を指す。
--
-- 行があれば「入っている」。外すときは行を消す。
-- thread_tags や watches と同じく、承認された物理削除の例外である。
-- 付け外しが日常的に起きるものを論理削除すると、
-- 同じ箱の履歴が積み上がるだけで、誰も読まない。
CREATE TABLE comment_checks (
  comment_id         uuid        NOT NULL REFERENCES comments(id),
  position           smallint    NOT NULL,

  -- 誰がいつ終わらせたか。本文には残らない事実なので、ここが唯一の記録になる。
  checked_by_user_id uuid        NOT NULL REFERENCES users(id),
  checked_at         timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (comment_id, position),

  CONSTRAINT comment_checks_position_range
    CHECK (position >= 0)
);


-- 投稿時に解決したメンション。本文の何文字目が誰なのかを持つ。
--
-- 表示のたびに現在の表示名と突き合わせる方式は採らない。
-- display_name は変更でき、一意でもない。
-- 別人が同じ名前に改名した瞬間、過去のコメントの指名先が入れ替わる。
-- 通知が飛んだ相手と画面に出る相手がずれるので、投稿時に固定する。
--
-- 本文は書き換わらないため、この位置は永久に正しい。
CREATE TABLE comment_mentions (
  comment_id   uuid NOT NULL REFERENCES comments(id),

  -- 本文の中の位置。@ を含む半開区間 [start_offset, end_offset)。
  start_offset int  NOT NULL,
  end_offset   int  NOT NULL,

  -- 同姓同名がいれば、同じ位置に複数の行が立つ。全員に通知するためである。
  user_id      uuid NOT NULL REFERENCES users(id),

  PRIMARY KEY (comment_id, start_offset, user_id),

  CONSTRAINT comment_mentions_span
    CHECK (start_offset >= 0 AND end_offset > start_offset)
);


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
