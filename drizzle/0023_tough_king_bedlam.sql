CREATE TABLE "statutory_rate_parameters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"parameter_key" text NOT NULL,
	"numeric_value" bigint NOT NULL,
	"unit" text NOT NULL,
	CONSTRAINT "statutory_rate_parameters_version_key_unique" UNIQUE("tenant_id","version_id","parameter_key"),
	CONSTRAINT "statutory_rate_parameters_key_check" CHECK ("statutory_rate_parameters"."parameter_key" ~ '^[a-z][a-z0-9_]{1,60}$'),
	CONSTRAINT "statutory_rate_parameters_unit_check" CHECK ("statutory_rate_parameters"."unit" in ('basis_points', 'paise', 'count')),
	CONSTRAINT "statutory_rate_parameters_value_check" CHECK ("statutory_rate_parameters"."numeric_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "statutory_rate_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rule_type" text NOT NULL,
	"jurisdiction" text DEFAULT 'IN' NOT NULL,
	"effective_from" date NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source_reference" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"recorded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "statutory_rate_versions_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "statutory_rate_versions_type_check" CHECK ("statutory_rate_versions"."rule_type" in ('epf', 'esi', 'professional_tax')),
	CONSTRAINT "statutory_rate_versions_jurisdiction_check" CHECK ("statutory_rate_versions"."jurisdiction" ~ '^[A-Z]{2,10}$'),
	CONSTRAINT "statutory_rate_versions_status_check" CHECK ("statutory_rate_versions"."status" in ('active', 'archived')),
	CONSTRAINT "statutory_rate_versions_source_check" CHECK (length("statutory_rate_versions"."source_reference") <= 200),
	CONSTRAINT "statutory_rate_versions_notes_check" CHECK (length("statutory_rate_versions"."notes") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "statutory_rate_parameters" ADD CONSTRAINT "statutory_rate_parameters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statutory_rate_parameters" ADD CONSTRAINT "statutory_rate_parameters_version_tenant_fk" FOREIGN KEY ("tenant_id","version_id") REFERENCES "public"."statutory_rate_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statutory_rate_versions" ADD CONSTRAINT "statutory_rate_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statutory_rate_versions" ADD CONSTRAINT "statutory_rate_versions_recorder_membership_fk" FOREIGN KEY ("tenant_id","recorded_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "statutory_rate_parameters_version_idx" ON "statutory_rate_parameters" USING btree ("tenant_id","version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "statutory_rate_versions_scope_effective_unique" ON "statutory_rate_versions" USING btree ("tenant_id",lower("rule_type"),upper("jurisdiction"),"effective_from");--> statement-breakpoint
CREATE INDEX "statutory_rate_versions_lookup_idx" ON "statutory_rate_versions" USING btree ("tenant_id","rule_type","jurisdiction","status","effective_from");