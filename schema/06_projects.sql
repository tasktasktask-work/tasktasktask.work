-- スレッドの器。閲覧範囲、ガントの範囲、メンションの候補、親子関係の範囲。
-- このシステムのいくつもの境界が、この一行に紐づいている。
CREATE TABLE projects (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid        NOT NULL REFERENCES organizations(id),
  key                text        NOT NULL,
  name               text        NOT NULL,
  description        text        NOT NULL DEFAULT '',
  visibility         text        NOT NULL DEFAULT 'public',
  archived_at        timestamptz,
  deleted_at         timestamptz,
  created_by_user_id uuid        NOT NULL REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  -- 作成後は変更できない。アプリケーション側で更新を拒否する。
  CONSTRAINT projects_key_format
    CHECK (key ~ '^[A-Z0-9]{2,10}$'),

  CONSTRAINT projects_name_not_blank
    CHECK (btrim(name) <> ''),

  CONSTRAINT projects_visibility_valid
    CHECK (visibility IN ('public', 'private')),

  -- アーカイブを経ないと削除できない。誤操作でいきなり消えることを防ぐ。
  CONSTRAINT projects_delete_after_archive
    CHECK (deleted_at IS NULL OR archived_at IS NOT NULL),

  -- threads からの複合外部キーの相手側。
  -- スレッドの組織とプロジェクトの組織が食い違う状態を拒否するために使う。
  CONSTRAINT projects_id_org_uniq UNIQUE (id, organization_id)
);

CREATE UNIQUE INDEX projects_key_uniq
  ON projects (organization_id, key) WHERE deleted_at IS NULL;

CREATE INDEX projects_by_org
  ON projects (organization_id) WHERE deleted_at IS NULL;



-- 非公開プロジェクトのメンバー。公開プロジェクトでは参照されない。
-- 組織管理者は行を持たなくても全プロジェクトの管理者として扱う。
CREATE TABLE project_members (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid        NOT NULL REFERENCES projects(id),
  user_id    uuid        NOT NULL REFERENCES users(id),
  is_admin   boolean     NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX project_members_uniq
  ON project_members (project_id, user_id) WHERE deleted_at IS NULL;

CREATE INDEX project_members_by_user
  ON project_members (user_id) WHERE deleted_at IS NULL;

