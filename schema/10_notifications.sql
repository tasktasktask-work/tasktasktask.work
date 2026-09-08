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

  -- 送信を試みた回数。送る前の取引で先に増やす。
  -- 送ってから増やす形にすると、送信の途中でプロセスが落ちる束は
  -- 回数が永久に 0 のまま、起動のたびに同じ場所で落ち続ける。
  email_attempts  integer     NOT NULL DEFAULT 0,

  -- 送るのを諦めた時刻。宛先が無い（SMTP の 5xx）か、試行が上限に達した。
  -- emailed_at を代わりに埋める手もあるが、送っていないものを
  -- 送ったことにすると、あとから届かなかった件を数えられない。
  email_gave_up_at timestamptz,

  created_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT notifications_kind_valid
    CHECK (kind IN ('mention', 'assigned', 'comment')),

  -- mention と comment は必ずコメントに紐づく
  CONSTRAINT notifications_comment_required
    CHECK (kind = 'assigned' OR comment_id IS NOT NULL),

  -- 自分の操作で自分に通知が来る状態を拒否する
  CONSTRAINT notifications_not_self
    CHECK (actor_user_id IS DISTINCT FROM user_id),

  -- メールの決着は一度きり。送ったのに諦めた、という行は作れない
  CONSTRAINT notifications_email_settled_once
    CHECK (emailed_at IS NULL OR email_gave_up_at IS NULL)
);

CREATE INDEX notifications_inbox
  ON notifications (user_id, created_at DESC);

CREATE INDEX notifications_unread
  ON notifications (user_id) WHERE read_at IS NULL;

-- 巡回が拾う行。古い順に送るので created_at で並べる。
-- 諦めた行を条件から外しておかないと、二度と送らないものを毎分読み続ける。
-- 上限の回数を述語に書かないのは、上限を変えるたびに移行が要るためである。
CREATE INDEX notifications_pending_email
  ON notifications (created_at)
  WHERE emailed_at IS NULL AND email_gave_up_at IS NULL;
