CREATE TABLE "compliance_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"service_code" text NOT NULL,
	"frequency" text NOT NULL,
	"due_month_offset" integer DEFAULT 1 NOT NULL,
	"due_day" integer NOT NULL,
	"internal_lead_days" integer DEFAULT 3 NOT NULL,
	"effective_from" date NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compliance_schedules_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "compliance_schedules_service_code_check" CHECK ("compliance_schedules"."service_code" ~ '^[A-Z0-9][A-Z0-9_-]{1,19}$'),
	CONSTRAINT "compliance_schedules_frequency_check" CHECK ("compliance_schedules"."frequency" in ('monthly', 'quarterly', 'annual')),
	CONSTRAINT "compliance_schedules_due_day_check" CHECK ("compliance_schedules"."due_day" between 1 and 31),
	CONSTRAINT "compliance_schedules_due_month_offset_check" CHECK ("compliance_schedules"."due_month_offset" between 0 and 12),
	CONSTRAINT "compliance_schedules_internal_lead_check" CHECK ("compliance_schedules"."internal_lead_days" between 0 and 60),
	CONSTRAINT "compliance_schedules_status_check" CHECK ("compliance_schedules"."status" in ('active', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "compliance_schedules" ADD CONSTRAINT "compliance_schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_schedules_tenant_service_effective_unique" ON "compliance_schedules" USING btree ("tenant_id",lower("service_code"),"effective_from");--> statement-breakpoint
CREATE INDEX "compliance_schedules_tenant_status_idx" ON "compliance_schedules" USING btree ("tenant_id","status","effective_from");