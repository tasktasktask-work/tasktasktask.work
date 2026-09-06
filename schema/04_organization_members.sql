-- ユーザーと組織を多対多で結ぶ。役割もここに持つ。
-- 役割は人の属性ではなく、人と組織の関係の属性である。
CREATE TABLE organization_members (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id),
  user_id         uuid        NOT NULL REFERENCES users(id),
  role            text        NOT NULL DEFAULT 'member',
  deleted_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT organization_members_role_valid
    CHECK (role IN ('admin', 'member'))
);

CREATE UNIQUE INDEX organization_members_uniq
  ON organization_members (organization_id, user_id) WHERE deleted_at IS NULL;

CREATE INDEX organization_members_by_user
  ON organization_members (user_id) WHERE deleted_at IS NULL;

-- 「最後の組織管理者を外せない」という制約は行数の下限であり、
-- CHECK では表現できない。アプリケーション側で担保する。

