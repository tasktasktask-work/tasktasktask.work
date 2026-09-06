-- ログイン中であることを表す。30日で切れ、アクセスによる延長はしない。
-- Cookie に入る値そのものは保存しない（SHA-256 のみ）。
CREATE TABLE sessions (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users(id),
  token_hash bytea       NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  user_agent text,
  created_ip inet,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX sessions_token_hash_key ON sessions (token_hash);
CREATE INDEX sessions_by_user ON sessions (user_id) WHERE revoked_at IS NULL;

-- 期限切れの行は定期的に物理削除してよい。記録として残す価値がない。


-- メールで送るログイン用URLに埋め込むトークン。48時間、一度きり。
-- 検証成功時に users.locked_at をリセットする（アカウントロックの解除経路）。
CREATE TABLE magic_link_tokens (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES users(id),
  token_hash bytea       NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX magic_link_tokens_hash_key ON magic_link_tokens (token_hash);
CREATE INDEX magic_link_tokens_by_user
  ON magic_link_tokens (user_id) WHERE used_at IS NULL;


-- 組織にメンバーが増える唯一の経路。
-- 送った時点ではアカウントが存在しないことがあるため、独立したテーブルが要る。
CREATE TABLE invitations (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid        NOT NULL REFERENCES organizations(id),
  email              text        NOT NULL,   -- 小文字で正規化して保存する
  role               text        NOT NULL DEFAULT 'member',
  invited_by_user_id uuid        NOT NULL REFERENCES users(id),
  token_hash         bytea       NOT NULL,
  expires_at         timestamptz NOT NULL,
  accepted_at        timestamptz,
  accepted_user_id   uuid        REFERENCES users(id),
  revoked_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT invitations_email_lowercase
    CHECK (email = lower(email)),
  CONSTRAINT invitations_role_valid
    CHECK (role IN ('admin', 'member')),
  CONSTRAINT invitations_accepted_consistent
    CHECK ((accepted_at IS NULL) = (accepted_user_id IS NULL))
);

CREATE UNIQUE INDEX invitations_token_hash_key ON invitations (token_hash);

-- 同じ相手への未処理の招待は一件まで
CREATE UNIQUE INDEX invitations_pending_uniq
  ON invitations (organization_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
