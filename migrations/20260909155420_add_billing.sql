-- Modify "organizations" table
ALTER TABLE "organizations"
  ADD COLUMN "trial_ends_on" date NOT NULL DEFAULT (((date_trunc('month'::text, (now() AT TIME ZONE 'Asia/Tokyo'::text)) + '2 mons'::interval) - '1 day'::interval))::date,
  ADD COLUMN "billing_exempt" boolean NOT NULL DEFAULT false,
  ADD COLUMN "stripe_customer_id" text NULL,
  ADD COLUMN "payment_method_set_at" timestamptz NULL,
  ADD COLUMN "billing_notice_stage" smallint NOT NULL DEFAULT 0;

-- 既存行を走査させないため、制約は NOT VALID で足してから検証する。
ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_notice_stage_range"
    CHECK ((billing_notice_stage >= 0) AND (billing_notice_stage <= 3)) NOT VALID;

ALTER TABLE "organizations" VALIDATE CONSTRAINT "organizations_notice_stage_range";
-- Create index "organizations_stripe_customer_key" to table: "organizations"
-- lint-ok: 対象が stripe_customer_id IS NOT NULL の部分索引で、既存行はすべて NULL。走査する行が無い
CREATE UNIQUE INDEX "organizations_stripe_customer_key" ON "organizations" ("stripe_customer_id") WHERE (stripe_customer_id IS NOT NULL);
-- Create "billing_invoices" table
CREATE TABLE "billing_invoices" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" uuid NOT NULL,
  "billing_month" date NOT NULL,
  "member_count" integer NOT NULL,
  "unit_price" integer NOT NULL,
  "subtotal" integer NOT NULL,
  "tax_amount" integer NULL,
  "total_amount" integer NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "stripe_invoice_id" text NULL,
  "invoice_pdf_url" text NULL,
  "paid_at" timestamptz NULL,
  "failed_at" timestamptz NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "billing_invoices_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "billing_invoices_first_of_month" CHECK (EXTRACT(day FROM billing_month) = (1)::numeric),
  CONSTRAINT "billing_invoices_member_count_positive" CHECK (member_count >= 1),
  CONSTRAINT "billing_invoices_open_has_stripe" CHECK ((status = 'pending'::text) OR (stripe_invoice_id IS NOT NULL)),
  CONSTRAINT "billing_invoices_paid_has_time" CHECK ((status = 'paid'::text) = (paid_at IS NOT NULL)),
  CONSTRAINT "billing_invoices_status_valid" CHECK (status = ANY (ARRAY['pending'::text, 'open'::text, 'paid'::text, 'unpaid'::text])),
  CONSTRAINT "billing_invoices_subtotal_matches" CHECK (subtotal = (member_count * unit_price)),
  CONSTRAINT "billing_invoices_unit_price_positive" CHECK (unit_price >= 1)
);
-- Create index "billing_invoices_month_key" to table: "billing_invoices"
CREATE UNIQUE INDEX "billing_invoices_month_key" ON "billing_invoices" ("organization_id", "billing_month");
-- Create index "billing_invoices_stripe_key" to table: "billing_invoices"
CREATE UNIQUE INDEX "billing_invoices_stripe_key" ON "billing_invoices" ("stripe_invoice_id") WHERE (stripe_invoice_id IS NOT NULL);
-- Create index "billing_invoices_unpaid" to table: "billing_invoices"
CREATE INDEX "billing_invoices_unpaid" ON "billing_invoices" ("organization_id") WHERE (status = 'unpaid'::text);
-- Create "billing_invoice_members" table
CREATE TABLE "billing_invoice_members" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "billing_invoice_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "display_name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "billing_invoice_members_billing_invoice_id_fkey" FOREIGN KEY ("billing_invoice_id") REFERENCES "billing_invoices" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "billing_invoice_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON UPDATE NO ACTION ON DELETE NO ACTION,
  CONSTRAINT "billing_invoice_members_name_not_blank" CHECK (btrim(display_name) <> ''::text)
);
-- Create index "billing_invoice_members_uniq" to table: "billing_invoice_members"
CREATE UNIQUE INDEX "billing_invoice_members_uniq" ON "billing_invoice_members" ("billing_invoice_id", "user_id");
