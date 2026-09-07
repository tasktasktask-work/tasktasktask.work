-- Create "comment_checks" table
CREATE TABLE "comment_checks" (
  "comment_id" uuid NOT NULL,
  "position" smallint NOT NULL,
  "checked_by_user_id" uuid NOT NULL,
  "checked_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("comment_id", "position"),
  CONSTRAINT "comment_checks_checked_by_user_id_fkey" FOREIGN KEY ("checked_by_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "comment_checks_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "comment_checks_position_range" CHECK ("position" >= 0)
);
-- Create "comment_mentions" table
CREATE TABLE "comment_mentions" (
  "comment_id" uuid NOT NULL,
  "start_offset" integer NOT NULL,
  "end_offset" integer NOT NULL,
  "user_id" uuid NOT NULL,
  PRIMARY KEY ("comment_id", "start_offset", "user_id"),
  CONSTRAINT "comment_mentions_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "comment_mentions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "comment_mentions_span" CHECK ((start_offset >= 0) AND (end_offset > start_offset))
);
