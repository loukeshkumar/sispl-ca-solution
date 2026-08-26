ALTER TABLE "invoice_lines" ADD COLUMN "sac_code" text;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "tax_rate_bp" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "cgst_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "sgst_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "igst_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "supplier_gstin" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "supplier_state_code" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "recipient_gstin" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "recipient_state_code" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "place_of_supply_code" text;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "supply_type" text DEFAULT 'intra_state' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "reverse_charge" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "cgst_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "sgst_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "igst_paise" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "legal_entities" ADD COLUMN "gstin" text;--> statement-breakpoint
ALTER TABLE "legal_entities" ADD COLUMN "state_code" text;--> statement-breakpoint
ALTER TABLE "service_catalog" ADD COLUMN "sac_code" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "gstin" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "state_code" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "address_line" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_sac_check" CHECK ("invoice_lines"."sac_code" is null or "invoice_lines"."sac_code" ~ '^[0-9]{4,8}$');--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tax_rate_check" CHECK ("invoice_lines"."tax_rate_bp" in (0, 50, 100, 300, 500, 1200, 1800, 2800));--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_gst_component_check" CHECK ("invoice_lines"."cgst_paise" >= 0 and "invoice_lines"."sgst_paise" >= 0 and "invoice_lines"."igst_paise" >= 0);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_supply_type_check" CHECK ("invoices"."supply_type" in ('intra_state', 'inter_state', 'export', 'exempt'));--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_gst_component_check" CHECK ("invoices"."cgst_paise" >= 0 and "invoices"."sgst_paise" >= 0 and "invoices"."igst_paise" >= 0 and "invoices"."cgst_paise" + "invoices"."sgst_paise" + "invoices"."igst_paise" = "invoices"."tax_paise");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_gst_split_check" CHECK (
    ("invoices"."supply_type" = 'intra_state' and "invoices"."igst_paise" = 0 and "invoices"."cgst_paise" = "invoices"."sgst_paise")
    or ("invoices"."supply_type" = 'inter_state' and "invoices"."cgst_paise" = 0 and "invoices"."sgst_paise" = 0)
    or ("invoices"."supply_type" in ('export', 'exempt') and "invoices"."tax_paise" = 0)
  );--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_reverse_charge_check" CHECK ("invoices"."reverse_charge" = false or "invoices"."tax_paise" = 0);--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_gstin_format_check" CHECK (
    ("invoices"."supplier_gstin" is null or "invoices"."supplier_gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$')
    and ("invoices"."recipient_gstin" is null or "invoices"."recipient_gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$')
  );--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_state_code_format_check" CHECK (
    ("invoices"."supplier_state_code" is null or "invoices"."supplier_state_code" ~ '^[0-9]{2}$')
    and ("invoices"."recipient_state_code" is null or "invoices"."recipient_state_code" ~ '^[0-9]{2}$')
    and ("invoices"."place_of_supply_code" is null or "invoices"."place_of_supply_code" ~ '^[0-9]{2}$')
  );--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_tax_identity_check" CHECK (
    "invoices"."status" not in ('issued', 'paid') or ("invoices"."supplier_state_code" is not null and "invoices"."place_of_supply_code" is not null)
  );--> statement-breakpoint
ALTER TABLE "legal_entities" ADD CONSTRAINT "legal_entities_gstin_check" CHECK ("legal_entities"."gstin" is null or "legal_entities"."gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');--> statement-breakpoint
ALTER TABLE "legal_entities" ADD CONSTRAINT "legal_entities_state_code_check" CHECK ("legal_entities"."state_code" is null or "legal_entities"."state_code" ~ '^[0-9]{2}$');--> statement-breakpoint
ALTER TABLE "legal_entities" ADD CONSTRAINT "legal_entities_gstin_state_check" CHECK ("legal_entities"."gstin" is null or "legal_entities"."state_code" is null or left("legal_entities"."gstin", 2) = "legal_entities"."state_code");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_gstin_check" CHECK ("tenants"."gstin" is null or "tenants"."gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$');--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_state_code_check" CHECK ("tenants"."state_code" is null or "tenants"."state_code" ~ '^[0-9]{2}$');--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_gstin_state_check" CHECK ("tenants"."gstin" is null or "tenants"."state_code" is null or left("tenants"."gstin", 2) = "tenants"."state_code");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_address_check" CHECK (length("tenants"."address_line") <= 300);