CREATE TABLE "document_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text DEFAULT 'General' NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"service_code" text DEFAULT '' NOT NULL,
	"default_lead_days" integer DEFAULT 7 NOT NULL,
	"mandatory" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_checklist_items_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "document_checklist_items_code_check" CHECK ("document_checklist_items"."code" ~ '^[A-Z0-9][A-Z0-9_-]{1,29}$'),
	CONSTRAINT "document_checklist_items_name_check" CHECK (length(trim("document_checklist_items"."name")) between 2 and 120),
	CONSTRAINT "document_checklist_items_category_check" CHECK (length(trim("document_checklist_items"."category")) between 2 and 40),
	CONSTRAINT "document_checklist_items_instructions_check" CHECK (length("document_checklist_items"."instructions") <= 500),
	CONSTRAINT "document_checklist_items_service_check" CHECK ("document_checklist_items"."service_code" = '' or "document_checklist_items"."service_code" ~ '^[A-Z0-9][A-Z0-9_-]{1,19}$'),
	CONSTRAINT "document_checklist_items_lead_days_check" CHECK ("document_checklist_items"."default_lead_days" between 0 and 180),
	CONSTRAINT "document_checklist_items_status_check" CHECK ("document_checklist_items"."status" in ('active', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "document_checklist_items" ADD CONSTRAINT "document_checklist_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_checklist_items" ADD CONSTRAINT "document_checklist_items_creator_membership_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_checklist_items_tenant_code_lower_unique" ON "document_checklist_items" USING btree ("tenant_id",lower("code"));--> statement-breakpoint
CREATE INDEX "document_checklist_items_tenant_status_idx" ON "document_checklist_items" USING btree ("tenant_id","status","category");