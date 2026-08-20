CREATE TABLE "filing_acknowledgements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"work_item_id" uuid,
	"portal" text NOT NULL,
	"filing_type" text NOT NULL,
	"period_key" text NOT NULL,
	"acknowledgement_number" text NOT NULL,
	"filed_on" date NOT NULL,
	"portal_status" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"remarks" text DEFAULT '' NOT NULL,
	"recorded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "filing_acknowledgements_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "filing_acknowledgements_portal_check" CHECK ("filing_acknowledgements"."portal" in ('gstn', 'income_tax', 'traces', 'mca', 'other')),
	CONSTRAINT "filing_acknowledgements_type_check" CHECK (length(trim("filing_acknowledgements"."filing_type")) between 2 and 40),
	CONSTRAINT "filing_acknowledgements_period_check" CHECK (length(trim("filing_acknowledgements"."period_key")) between 2 and 60),
	CONSTRAINT "filing_acknowledgements_reference_check" CHECK ("filing_acknowledgements"."acknowledgement_number" ~ '^[A-Za-z0-9/-]{6,40}$'),
	CONSTRAINT "filing_acknowledgements_status_check" CHECK ("filing_acknowledgements"."portal_status" in ('filed', 'filed_late', 'processed', 'defective', 'rejected')),
	CONSTRAINT "filing_acknowledgements_source_check" CHECK ("filing_acknowledgements"."source" in ('manual', 'api')),
	CONSTRAINT "filing_acknowledgements_remarks_check" CHECK (length("filing_acknowledgements"."remarks") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "filing_acknowledgements" ADD CONSTRAINT "filing_acknowledgements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filing_acknowledgements" ADD CONSTRAINT "filing_acknowledgements_entity_tenant_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "public"."legal_entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filing_acknowledgements" ADD CONSTRAINT "filing_acknowledgements_work_tenant_fk" FOREIGN KEY ("tenant_id","work_item_id") REFERENCES "public"."work_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filing_acknowledgements" ADD CONSTRAINT "filing_acknowledgements_recorder_membership_fk" FOREIGN KEY ("tenant_id","recorded_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "filing_acknowledgements_tenant_reference_unique" ON "filing_acknowledgements" USING btree ("tenant_id",upper("acknowledgement_number"));--> statement-breakpoint
CREATE INDEX "filing_acknowledgements_entity_period_idx" ON "filing_acknowledgements" USING btree ("tenant_id","legal_entity_id","period_key");