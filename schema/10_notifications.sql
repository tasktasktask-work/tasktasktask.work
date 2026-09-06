-- 通知を受け取る意思表示。自動では作られない。
-- thread_tags と同じく、承認された物理削除の例外である。
CREATE TABLE watches (
  thread_id  uuid        NOT NULL REFERENCES threads(id),
  user_id    uuid        NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (thread_id, user_id)
);

CREATE INDEX watches_by_user ON watches (user_id);


-- 三つのきっかけで作られる。
-- アプリ内の一覧とメールの両方に届き、既読を持つのはアプリ内の側だけ。
CREATE TABLE notifications (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id),
  user_id         uuid        NOT NULL REFERENCES users(id),
  kind            text        NOT NULL,
  thread_id       uuid        NOT NULL REFERENCES threads(id),
  comment_id      uuid        REFERENCES comments(id),
  actor_user_id   uuid        REFERENCES users(id),
  read_at         timestamptz,

  -- メール送信は失敗しうるうえ、外部への呼び出しなので同期的に待たない。
  -- 行を先に作り、未送信のものを後から拾って送る。
  emailed_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT notifications_kind_valid
    CHECK (kind IN ('mention', 'assigned', 'comment')),

  -- mention と comment は必ずコメントに紐づく
  CONSTRAINT notifications_comment_required
    CHECK (kind = 'assigned' OR comment_id IS NOT NULL),

  -- 自分の操作で自分に通知が来る状態を拒否する
  CONSTRAINT notifications_not_self
    CHECK (actor_user_id IS DISTINCT FROM user_id)
);

CREATE INDEX notifications_inbox
  ON notifications (user_id, created_at DESC);

CREATE INDEX notifications_unread
  ON notifications (user_id) WHERE read_at IS NULL;

CREATE INDEX notifications_pending_email
  ON notifications (created_at) WHERE emailed_at IS NULL;
