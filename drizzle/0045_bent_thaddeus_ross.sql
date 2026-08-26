CREATE TABLE "client_compliance_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"service_code" text NOT NULL,
	"mode" text DEFAULT 'override' NOT NULL,
	"frequency" text,
	"due_month_offset" integer,
	"due_day" integer,
	"internal_lead_days" integer,
	"effective_from" date NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_compliance_schedules_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "client_compliance_schedules_service_code_check" CHECK ("client_compliance_schedules"."service_code" ~ '^[A-Z0-9][A-Z0-9_-]{1,19}$'),
	CONSTRAINT "client_compliance_schedules_mode_check" CHECK ("client_compliance_schedules"."mode" in ('override', 'exempt')),
	CONSTRAINT "client_compliance_schedules_rule_pair_check" CHECK (
    ("client_compliance_schedules"."mode" = 'override'
      and "client_compliance_schedules"."frequency" is not null and "client_compliance_schedules"."due_month_offset" is not null
      and "client_compliance_schedules"."due_day" is not null and "client_compliance_schedules"."internal_lead_days" is not null)
    or ("client_compliance_schedules"."mode" = 'exempt'
      and "client_compliance_schedules"."frequency" is null and "client_compliance_schedules"."due_month_offset" is null
      and "client_compliance_schedules"."due_day" is null and "client_compliance_schedules"."internal_lead_days" is null)
  ),
	CONSTRAINT "client_compliance_schedules_frequency_check" CHECK ("client_compliance_schedules"."frequency" is null or "client_compliance_schedules"."frequency" in ('monthly', 'quarterly', 'annual')),
	CONSTRAINT "client_compliance_schedules_due_day_check" CHECK ("client_compliance_schedules"."due_day" is null or "client_compliance_schedules"."due_day" between 1 and 31),
	CONSTRAINT "client_compliance_schedules_due_month_offset_check" CHECK ("client_compliance_schedules"."due_month_offset" is null or "client_compliance_schedules"."due_month_offset" between 0 and 12),
	CONSTRAINT "client_compliance_schedules_internal_lead_check" CHECK ("client_compliance_schedules"."internal_lead_days" is null or "client_compliance_schedules"."internal_lead_days" between 0 and 60),
	CONSTRAINT "client_compliance_schedules_note_check" CHECK (length("client_compliance_schedules"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "compliance_extensions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"service_code" text NOT NULL,
	"period_key" text NOT NULL,
	"legal_entity_id" uuid,
	"original_due_date" date NOT NULL,
	"extended_due_date" date NOT NULL,
	"authority" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"applied_at" timestamp with time zone,
	"applied_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compliance_extensions_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "compliance_extensions_service_code_check" CHECK ("compliance_extensions"."service_code" ~ '^[A-Z0-9][A-Z0-9_-]{1,19}$'),
	CONSTRAINT "compliance_extensions_period_check" CHECK (length(trim("compliance_extensions"."period_key")) between 2 and 60),
	CONSTRAINT "compliance_extensions_direction_check" CHECK ("compliance_extensions"."extended_due_date" > "compliance_extensions"."original_due_date"),
	CONSTRAINT "compliance_extensions_authority_check" CHECK (length(trim("compliance_extensions"."authority")) between 2 and 200),
	CONSTRAINT "compliance_extensions_note_check" CHECK (length("compliance_extensions"."note") <= 500),
	CONSTRAINT "compliance_extensions_applied_count_check" CHECK ("compliance_extensions"."applied_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "original_statutory_due_date" date;--> statement-breakpoint
ALTER TABLE "client_compliance_schedules" ADD CONSTRAINT "client_compliance_schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_compliance_schedules" ADD CONSTRAINT "client_compliance_schedules_entity_tenant_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "public"."legal_entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_compliance_schedules" ADD CONSTRAINT "client_compliance_schedules_creator_membership_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_extensions" ADD CONSTRAINT "compliance_extensions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_extensions" ADD CONSTRAINT "compliance_extensions_entity_tenant_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "public"."legal_entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_extensions" ADD CONSTRAINT "compliance_extensions_creator_membership_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_compliance_schedules_entity_service_effective_unique" ON "client_compliance_schedules" USING btree ("tenant_id","legal_entity_id",lower("service_code"),"effective_from");--> statement-breakpoint
CREATE INDEX "client_compliance_schedules_lookup_idx" ON "client_compliance_schedules" USING btree ("tenant_id","service_code","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_extensions_class_unique" ON "compliance_extensions" USING btree ("tenant_id",lower("service_code"),"period_key") WHERE "compliance_extensions"."legal_entity_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_extensions_client_unique" ON "compliance_extensions" USING btree ("tenant_id",lower("service_code"),"period_key","legal_entity_id") WHERE "compliance_extensions"."legal_entity_id" is not null;--> statement-breakpoint
CREATE INDEX "compliance_extensions_lookup_idx" ON "compliance_extensions" USING btree ("tenant_id","service_code","period_key");