-- メールの送信状態を notifications に足す。
--
-- 列の追加だけで、既存の行は既定値で埋まる（Postgres 11 以降は書き換えない）。
-- 制約は NOT VALID を経由してから検査する。
ALTER TABLE "notifications"
  ADD COLUMN "email_attempts" integer NOT NULL DEFAULT 0,
  ADD COLUMN "email_gave_up_at" timestamptz NULL;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_email_settled_once"
  CHECK ((emailed_at IS NULL) OR (email_gave_up_at IS NULL)) NOT VALID;

ALTER TABLE "notifications" VALIDATE CONSTRAINT "notifications_email_settled_once";
