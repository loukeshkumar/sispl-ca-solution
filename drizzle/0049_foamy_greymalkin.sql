ALTER TABLE "invoice_lines" DROP CONSTRAINT "invoice_lines_type_check";--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "value_paise" bigint;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "minutes" integer;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "write_off_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD COLUMN "work_item_id" uuid;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "invoice_line_id" uuid;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_work_tenant_fk" FOREIGN KEY ("tenant_id","work_item_id") REFERENCES "public"."work_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_entries_unbilled_idx" ON "time_entries" USING btree ("tenant_id","legal_entity_id","invoice_line_id");--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_invoice_line_tenant_fk" FOREIGN KEY ("tenant_id","invoice_line_id") REFERENCES "public"."invoice_lines"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_time_pair_check" CHECK (
    ("invoice_lines"."line_type" = 'time' and "invoice_lines"."value_paise" is not null and "invoice_lines"."minutes" is not null and "invoice_lines"."minutes" > 0)
    or ("invoice_lines"."line_type" <> 'time' and "invoice_lines"."value_paise" is null and "invoice_lines"."minutes" is null)
  );--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_write_off_check" CHECK (
    "invoice_lines"."value_paise" is null
    or abs("invoice_lines"."amount_paise" - "invoice_lines"."value_paise") <= greatest(10000, "invoice_lines"."value_paise" / 100)
    or length(trim("invoice_lines"."write_off_reason")) > 0
  );--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_write_off_length_check" CHECK (length("invoice_lines"."write_off_reason") <= 500);--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_type_check" CHECK ("invoice_lines"."line_type" in ('package_fee', 'addon', 'service', 'adjustment', 'time'));