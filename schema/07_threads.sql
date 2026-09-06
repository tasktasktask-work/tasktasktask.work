-- 課題も議論も質問も、この一つのテーブルに入る。
-- 種別によって使える列が変わるため、制約がここに集中している。
CREATE TABLE threads (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid        NOT NULL,
  project_id         uuid        NOT NULL,

  -- 組織の中で通し番号。プロジェクトごとには振り直さない。
  -- 表示は projects.key を前に付けて WEB-128 の形になる。
  number             integer     NOT NULL,

  type               text        NOT NULL,
  title              text        NOT NULL,
  body               text        NOT NULL DEFAULT '',

  -- 本文かタイトルを編集した時刻。「編集済み」の印に使う。履歴は残さない。
  body_edited_at     timestamptz,

  progress           smallint    NOT NULL DEFAULT 0,

  -- 課題のみ。時刻を持たない。
  -- 組織ごとにタイムゾーンを設定できるため、時刻を持つと設定変更で日付が前後する。
  starts_on          date,
  ends_on            date,

  assignee_user_id   uuid        REFERENCES users(id),
  parent_thread_id   uuid,
  created_by_user_id uuid        NOT NULL REFERENCES users(id),
  archived_at        timestamptz,
  deleted_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- プロジェクトと組織の整合をデータベース側で保証する
  CONSTRAINT threads_project_fk
    FOREIGN KEY (project_id, organization_id)
    REFERENCES projects (id, organization_id),

  -- 親子は同じプロジェクトに閉じる。
  -- 親の project_id が自分と一致しなければ、この外部キーが成立しない。
  -- parent_thread_id が NULL のときは（MATCH SIMPLE のため）検査されない。
  CONSTRAINT threads_parent_fk
    FOREIGN KEY (parent_thread_id, project_id)
    REFERENCES threads (id, project_id),

  CONSTRAINT threads_id_project_uniq UNIQUE (id, project_id),

  CONSTRAINT threads_type_valid
    CHECK (type IN ('kadai', 'giron', 'shitsumon')),

  CONSTRAINT threads_title_not_blank
    CHECK (btrim(title) <> ''),

  CONSTRAINT threads_progress_range
    CHECK (progress BETWEEN 0 AND 100),

  -- 議論と質問は 0 か 100 しか取らない（オープンとクローズ）
  CONSTRAINT threads_progress_binary_for_non_kadai
    CHECK (type = 'kadai' OR progress IN (0, 100)),

  -- 議論と質問は期間を持たない
  CONSTRAINT threads_period_only_for_kadai
    CHECK (type = 'kadai' OR (starts_on IS NULL AND ends_on IS NULL)),

  -- 期間は両方入れるか両方空けるか
  CONSTRAINT threads_period_paired
    CHECK ((starts_on IS NULL) = (ends_on IS NULL)),

  CONSTRAINT threads_period_ordered
    CHECK (starts_on IS NULL OR starts_on <= ends_on),

  CONSTRAINT threads_not_own_parent
    CHECK (parent_thread_id IS DISTINCT FROM id),

  CONSTRAINT threads_delete_after_archive
    CHECK (deleted_at IS NULL OR archived_at IS NOT NULL)
);

-- 番号は欠番のまま保つため、削除済みも含めて一意にする
CREATE UNIQUE INDEX threads_number_uniq
  ON threads (organization_id, number);

CREATE INDEX threads_by_project
  ON threads (project_id, updated_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX threads_by_assignee
  ON threads (assignee_user_id, ends_on) WHERE deleted_at IS NULL;

CREATE INDEX threads_by_parent
  ON threads (parent_thread_id) WHERE deleted_at IS NULL;

CREATE INDEX threads_gantt
  ON threads (project_id, starts_on, ends_on)
  WHERE type = 'kadai' AND deleted_at IS NULL AND archived_at IS NULL;

-- 循環参照（A の親が B、B の親が A）は CHECK では表現できない。
-- 親を設定するときにアプリケーション側で祖先を辿り、自分自身が現れないことを確認する。

