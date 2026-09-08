-- Modify "attachments" table
ALTER TABLE "attachments"
  ADD COLUMN "deleted_by_user_id" uuid NULL,
  ADD CONSTRAINT "attachments_deleted_by_user_id_fkey"
    FOREIGN KEY ("deleted_by_user_id") REFERENCES "users" ("id")
    ON UPDATE NO ACTION ON DELETE NO ACTION;

ALTER TABLE "attachments"
  ADD CONSTRAINT "attachments_deleted_together"
    CHECK ((deleted_at IS NULL) = (deleted_by_user_id IS NULL)) NOT VALID;

ALTER TABLE "attachments" VALIDATE CONSTRAINT "attachments_deleted_together";

ALTER TABLE "attachments"
  ADD CONSTRAINT "attachments_filename_length"
    CHECK ((btrim(original_filename) <> ''::text) AND (length(original_filename) <= 255)) NOT VALID;

ALTER TABLE "attachments" VALIDATE CONSTRAINT "attachments_filename_length";
