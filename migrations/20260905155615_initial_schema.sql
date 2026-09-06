-- Create "users" table
CREATE TABLE "users" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "email" text NOT NULL,
  "display_name" text NOT NULL,
  "password_hash" text NULL,
  "failed_login_count" smallint NOT NULL DEFAULT 0,
  "locked_at" timestamptz NULL,
  "email_notifications_enabled" boolean NOT NULL DEFAULT true,
  "deleted_at" timestamptz NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "users_display_name_not_blank" CHECK (btrim(display_name) <> ''::text),
  CONSTRAINT "users_email_lowercase" CHECK (email = lower(email)),
  CONSTRAINT "users_email_shape" CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'::text),
  CONSTRAINT "users_failed_login_count_range" CHECK ((failed_login_count >= 0) AND (failed_login_count <= 10))
);
-- Create index "users_email_key" to table: "users"
CREATE UNIQUE INDEX "users_email_key" ON "users" ("email") WHERE (deleted_at IS NULL);
-- Create "organizations" table
CREATE TABLE "organizations" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "language" text NOT NULL DEFAULT 'ja',
  "timezone" text NOT NULL DEFAULT 'Asia/Tokyo',
  "next_thread_number" integer NOT NULL DEFAULT 1,
  "deleted_at" timestamptz NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "organizations_language_supported" CHECK (language = 'ja'::text),
  CONSTRAINT "organizations_name_not_blank" CHECK (btrim(name) <> ''::text),
  CONSTRAINT "organizations_next_number_positive" CHECK (next_thread_number >= 1),
  CONSTRAINT "organizations_slug_format" CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'::text)
);
-- Create index "organizations_slug_key" to table: "organizations"
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations" ("slug") WHERE (deleted_at IS NULL);
-- Create "projects" table
CREATE TABLE "projects" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL,
  "key" text NOT NULL,
  "name" text NOT NULL,
  "description" text NOT NULL DEFAULT '',
  "visibility" text NOT NULL DEFAULT 'public',
  "archived_at" timestamptz NULL,
  "deleted_at" timestamptz NULL,
  "created_by_user_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "projects_id_org_uniq" UNIQUE ("id", "organization_id"),
  CONSTRAINT "projects_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "projects_delete_after_archive" CHECK ((deleted_at IS NULL) OR (archived_at IS NOT NULL)),
  CONSTRAINT "projects_key_format" CHECK (key ~ '^[A-Z0-9]{2,10}$'::text),
  CONSTRAINT "projects_name_not_blank" CHECK (btrim(name) <> ''::text),
  CONSTRAINT "projects_visibility_valid" CHECK (visibility = ANY (ARRAY['public'::text, 'private'::text]))
);
-- Create index "projects_by_org" to table: "projects"
CREATE INDEX "projects_by_org" ON "projects" ("organization_id") WHERE (deleted_at IS NULL);
-- Create index "projects_key_uniq" to table: "projects"
CREATE UNIQUE INDEX "projects_key_uniq" ON "projects" ("organization_id", "key") WHERE (deleted_at IS NULL);
-- Create "threads" table
CREATE TABLE "threads" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "number" integer NOT NULL,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL DEFAULT '',
  "body_edited_at" timestamptz NULL,
  "progress" smallint NOT NULL DEFAULT 0,
  "starts_on" date NULL,
  "ends_on" date NULL,
  "assignee_user_id" uuid NULL,
  "parent_thread_id" uuid NULL,
  "created_by_user_id" uuid NOT NULL,
  "archived_at" timestamptz NULL,
  "deleted_at" timestamptz NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "threads_id_project_uniq" UNIQUE ("id", "project_id"),
  CONSTRAINT "threads_assignee_user_id_fkey" FOREIGN KEY ("assignee_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "threads_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "threads_parent_fk" FOREIGN KEY ("parent_thread_id", "project_id") REFERENCES "threads" ("id", "project_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "threads_project_fk" FOREIGN KEY ("project_id", "organization_id") REFERENCES "projects" ("id", "organization_id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "threads_delete_after_archive" CHECK ((deleted_at IS NULL) OR (archived_at IS NOT NULL)),
  CONSTRAINT "threads_not_own_parent" CHECK (parent_thread_id IS DISTINCT FROM id),
  CONSTRAINT "threads_period_only_for_kadai" CHECK ((type = 'kadai'::text) OR ((starts_on IS NULL) AND (ends_on IS NULL))),
  CONSTRAINT "threads_period_ordered" CHECK ((starts_on IS NULL) OR (starts_on <= ends_on)),
  CONSTRAINT "threads_period_paired" CHECK ((starts_on IS NULL) = (ends_on IS NULL)),
  CONSTRAINT "threads_progress_binary_for_non_kadai" CHECK ((type = 'kadai'::text) OR (progress = ANY (ARRAY[0, 100]))),
  CONSTRAINT "threads_progress_range" CHECK ((progress >= 0) AND (progress <= 100)),
  CONSTRAINT "threads_title_not_blank" CHECK (btrim(title) <> ''::text),
  CONSTRAINT "threads_type_valid" CHECK (type = ANY (ARRAY['kadai'::text, 'giron'::text, 'shitsumon'::text]))
);
-- Create index "threads_by_assignee" to table: "threads"
CREATE INDEX "threads_by_assignee" ON "threads" ("assignee_user_id", "ends_on") WHERE (deleted_at IS NULL);
-- Create index "threads_by_parent" to table: "threads"
CREATE INDEX "threads_by_parent" ON "threads" ("parent_thread_id") WHERE (deleted_at IS NULL);
-- Create index "threads_by_project" to table: "threads"
CREATE INDEX "threads_by_project" ON "threads" ("project_id", "updated_at" DESC) WHERE (deleted_at IS NULL);
-- Create index "threads_gantt" to table: "threads"
CREATE INDEX "threads_gantt" ON "threads" ("project_id", "starts_on", "ends_on") WHERE ((type = 'kadai'::text) AND (deleted_at IS NULL) AND (archived_at IS NULL));
-- Create index "threads_number_uniq" to table: "threads"
CREATE UNIQUE INDEX "threads_number_uniq" ON "threads" ("organization_id", "number");
-- Create "comments" table
CREATE TABLE "comments" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL,
  "thread_id" uuid NOT NULL,
  "author_user_id" uuid NOT NULL,
  "body" text NOT NULL,
  "deleted_at" timestamptz NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "comments_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "comments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "comments_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "comments_body_not_blank" CHECK (btrim(body) <> ''::text)
);
-- Create index "comments_by_thread" to table: "comments"
CREATE INDEX "comments_by_thread" ON "comments" ("thread_id", "created_at") WHERE (deleted_at IS NULL);
-- Create "attachments" table
CREATE TABLE "attachments" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL,
  "thread_id" uuid NULL,
  "comment_id" uuid NULL,
  "storage_key" text NOT NULL,
  "original_filename" text NOT NULL,
  "byte_size" bigint NOT NULL,
  "declared_type" text NULL,
  "is_image" boolean NOT NULL DEFAULT false,
  "uploaded_by_user_id" uuid NOT NULL,
  "deleted_at" timestamptz NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "attachments_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "attachments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "attachments_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "attachments_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "attachments_exactly_one_owner" CHECK ((thread_id IS NULL) <> (comment_id IS NULL)),
  CONSTRAINT "attachments_size_limit" CHECK ((byte_size > 0) AND (byte_size <= ((10 * 1024) * 1024)))
);
-- Create index "attachments_by_comment" to table: "attachments"
CREATE INDEX "attachments_by_comment" ON "attachments" ("comment_id") WHERE (deleted_at IS NULL);
-- Create index "attachments_by_thread" to table: "attachments"
CREATE INDEX "attachments_by_thread" ON "attachments" ("thread_id") WHERE (deleted_at IS NULL);
-- Create index "attachments_storage_key_uniq" to table: "attachments"
CREATE UNIQUE INDEX "attachments_storage_key_uniq" ON "attachments" ("storage_key");
-- Create "invitations" table
CREATE TABLE "invitations" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL,
  "email" text NOT NULL,
  "role" text NOT NULL DEFAULT 'member',
  "invited_by_user_id" uuid NOT NULL,
  "token_hash" bytea NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "accepted_at" timestamptz NULL,
  "accepted_user_id" uuid NULL,
  "revoked_at" timestamptz NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "invitations_accepted_user_id_fkey" FOREIGN KEY ("accepted_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "invitations_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "invitations_accepted_consistent" CHECK ((accepted_at IS NULL) = (accepted_user_id IS NULL)),
  CONSTRAINT "invitations_email_lowercase" CHECK (email = lower(email)),
  CONSTRAINT "invitations_role_valid" CHECK (role = ANY (ARRAY['admin'::text, 'member'::text]))
);
-- Create index "invitations_pending_uniq" to table: "invitations"
CREATE UNIQUE INDEX "invitations_pending_uniq" ON "invitations" ("organization_id", "email") WHERE ((accepted_at IS NULL) AND (revoked_at IS NULL));
-- Create index "invitations_token_hash_key" to table: "invitations"
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations" ("token_hash");
-- Create "magic_link_tokens" table
CREATE TABLE "magic_link_tokens" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "token_hash" bytea NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "magic_link_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create index "magic_link_tokens_by_user" to table: "magic_link_tokens"
CREATE INDEX "magic_link_tokens_by_user" ON "magic_link_tokens" ("user_id") WHERE (used_at IS NULL);
-- Create index "magic_link_tokens_hash_key" to table: "magic_link_tokens"
CREATE UNIQUE INDEX "magic_link_tokens_hash_key" ON "magic_link_tokens" ("token_hash");
-- Create "notifications" table
CREATE TABLE "notifications" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "thread_id" uuid NOT NULL,
  "comment_id" uuid NULL,
  "actor_user_id" uuid NULL,
  "read_at" timestamptz NULL,
  "emailed_at" timestamptz NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "notifications_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "notifications_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "notifications_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "notifications_comment_required" CHECK ((kind = 'assigned'::text) OR (comment_id IS NOT NULL)),
  CONSTRAINT "notifications_kind_valid" CHECK (kind = ANY (ARRAY['mention'::text, 'assigned'::text, 'comment'::text])),
  CONSTRAINT "notifications_not_self" CHECK (actor_user_id IS DISTINCT FROM user_id)
);
-- Create index "notifications_inbox" to table: "notifications"
CREATE INDEX "notifications_inbox" ON "notifications" ("user_id", "created_at" DESC);
-- Create index "notifications_pending_email" to table: "notifications"
CREATE INDEX "notifications_pending_email" ON "notifications" ("created_at") WHERE (emailed_at IS NULL);
-- Create index "notifications_unread" to table: "notifications"
CREATE INDEX "notifications_unread" ON "notifications" ("user_id") WHERE (read_at IS NULL);
-- Create "organization_members" table
CREATE TABLE "organization_members" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" text NOT NULL DEFAULT 'member',
  "deleted_at" timestamptz NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "organization_members_role_valid" CHECK (role = ANY (ARRAY['admin'::text, 'member'::text]))
);
-- Create index "organization_members_by_user" to table: "organization_members"
CREATE INDEX "organization_members_by_user" ON "organization_members" ("user_id") WHERE (deleted_at IS NULL);
-- Create index "organization_members_uniq" to table: "organization_members"
CREATE UNIQUE INDEX "organization_members_uniq" ON "organization_members" ("organization_id", "user_id") WHERE (deleted_at IS NULL);
-- Create "project_members" table
CREATE TABLE "project_members" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "project_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "is_admin" boolean NOT NULL DEFAULT false,
  "deleted_at" timestamptz NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create index "project_members_by_user" to table: "project_members"
CREATE INDEX "project_members_by_user" ON "project_members" ("user_id") WHERE (deleted_at IS NULL);
-- Create index "project_members_uniq" to table: "project_members"
CREATE UNIQUE INDEX "project_members_uniq" ON "project_members" ("project_id", "user_id") WHERE (deleted_at IS NULL);
-- Create "sessions" table
CREATE TABLE "sessions" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL,
  "token_hash" bytea NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "revoked_at" timestamptz NULL,
  "user_agent" text NULL,
  "created_ip" inet NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create index "sessions_by_user" to table: "sessions"
CREATE INDEX "sessions_by_user" ON "sessions" ("user_id") WHERE (revoked_at IS NULL);
-- Create index "sessions_token_hash_key" to table: "sessions"
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" ("token_hash");
-- Create "tags" table
CREATE TABLE "tags" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL,
  "name" text NOT NULL,
  "color" text NOT NULL DEFAULT '#7d8792',
  "deleted_at" timestamptz NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "tags_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "tags_color_format" CHECK (color ~ '^#[0-9a-f]{6}$'::text),
  CONSTRAINT "tags_name_not_blank" CHECK ((btrim(name) <> ''::text) AND (length(name) <= 40))
);
-- Create index "tags_name_uniq" to table: "tags"
CREATE UNIQUE INDEX "tags_name_uniq" ON "tags" ("organization_id", (lower(name))) WHERE (deleted_at IS NULL);
-- Create "thread_tags" table
CREATE TABLE "thread_tags" (
  "thread_id" uuid NOT NULL,
  "tag_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("thread_id", "tag_id"),
  CONSTRAINT "thread_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "thread_tags_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create index "thread_tags_by_tag" to table: "thread_tags"
CREATE INDEX "thread_tags_by_tag" ON "thread_tags" ("tag_id");
-- Create "watches" table
CREATE TABLE "watches" (
  "thread_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("thread_id", "user_id"),
  CONSTRAINT "watches_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "threads" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "watches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION
);
-- Create index "watches_by_user" to table: "watches"
CREATE INDEX "watches_by_user" ON "watches" ("user_id");
