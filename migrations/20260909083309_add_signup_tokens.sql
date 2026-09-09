-- Create "signup_tokens" table
CREATE TABLE "signup_tokens" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "email" text NOT NULL,
  "token_hash" bytea NOT NULL,
  "expires_at" timestamptz NOT NULL,
  "used_at" timestamptz NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "signup_tokens_email_lowercase" CHECK (email = lower(email)),
  CONSTRAINT "signup_tokens_email_shape" CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'::text)
);
-- Create index "signup_tokens_by_email" to table: "signup_tokens"
CREATE INDEX "signup_tokens_by_email" ON "signup_tokens" ("email") WHERE (used_at IS NULL);
-- Create index "signup_tokens_hash_key" to table: "signup_tokens"
CREATE UNIQUE INDEX "signup_tokens_hash_key" ON "signup_tokens" ("token_hash");
