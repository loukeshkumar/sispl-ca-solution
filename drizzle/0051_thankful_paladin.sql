CREATE TABLE "invoice_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"received_on" date NOT NULL,
	"amount_paise" bigint NOT NULL,
	"tds_paise" bigint DEFAULT 0 NOT NULL,
	"tds_rate_bp" integer DEFAULT 0 NOT NULL,
	"tds_section" text DEFAULT '' NOT NULL,
	"instrument" text DEFAULT 'neft' NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"recorded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_receipts_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "invoice_receipts_amount_check" CHECK ("invoice_receipts"."amount_paise" >= 0 and "invoice_receipts"."tds_paise" >= 0 and "invoice_receipts"."amount_paise" + "invoice_receipts"."tds_paise" > 0),
	CONSTRAINT "invoice_receipts_tds_rate_check" CHECK ("invoice_receipts"."tds_rate_bp" between 0 and 3000),
	CONSTRAINT "invoice_receipts_tds_pair_check" CHECK (
    ("invoice_receipts"."tds_paise" = 0 and "invoice_receipts"."tds_rate_bp" = 0 and "invoice_receipts"."tds_section" = '')
    or ("invoice_receipts"."tds_paise" > 0 and "invoice_receipts"."tds_rate_bp" > 0 and length(trim("invoice_receipts"."tds_section")) > 0)
  ),
	CONSTRAINT "invoice_receipts_section_check" CHECK ("invoice_receipts"."tds_section" in ('', '194J', '194C', '194H', '194Q', '206C')),
	CONSTRAINT "invoice_receipts_instrument_check" CHECK ("invoice_receipts"."instrument" in ('neft', 'rtgs', 'imps', 'upi', 'cheque', 'cash', 'adjustment')),
	CONSTRAINT "invoice_receipts_text_check" CHECK (length("invoice_receipts"."reference") <= 120 and length("invoice_receipts"."note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_status_check";--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_issued_tax_identity_check";--> statement-breakpoint
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_issued_state_check";--> statement-breakpoint
ALTER TABLE "invoice_receipts" ADD CONSTRAINT "invoice_receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_receipts" ADD CONSTRAINT "invoice_receipts_invoice_tenant_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_receipts" ADD CONSTRAINT "invoice_receipts_recorder_membership_fk" FOREIGN KEY ("tenant_id","recorded_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_receipts_invoice_idx" ON "invoice_receipts" USING btree ("tenant_id","invoice_id","received_on");--> statement-breakpoint
CREATE INDEX "invoice_receipts_date_idx" ON "invoice_receipts" USING btree ("tenant_id","received_on");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_status_check" CHECK ("invoices"."status" in ('draft', 'issued', 'part_paid', 'paid', 'cancelled'));--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_tax_identity_check" CHECK (
    "invoices"."status" not in ('issued', 'part_paid', 'paid') or ("invoices"."supplier_state_code" is not null and "invoices"."place_of_supply_code" is not null)
  );--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_state_check" CHECK (("invoices"."status" in ('issued', 'part_paid', 'paid') and "invoices"."issued_at" is not null and "invoices"."issued_by_user_id" is not null and "invoices"."issue_date" is not null and "invoices"."due_date" is not null) or ("invoices"."status" in ('draft', 'cancelled') and ("invoices"."status" = 'cancelled' or "invoices"."issued_at" is null)));