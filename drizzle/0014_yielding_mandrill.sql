CREATE TABLE "client_package_assignment_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"service_code_snapshot" text NOT NULL,
	"service_name_snapshot" text NOT NULL,
	"service_category_snapshot" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_package_assignment_services_assignment_service_unique" UNIQUE("tenant_id","assignment_id","service_id"),
	CONSTRAINT "client_package_assignment_services_source_check" CHECK ("client_package_assignment_services"."source" in ('package', 'addon'))
);
--> statement-breakpoint
CREATE TABLE "client_package_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date,
	"status" text NOT NULL,
	"package_code_snapshot" text NOT NULL,
	"package_name_snapshot" text NOT NULL,
	"billing_cycle_snapshot" text NOT NULL,
	"standard_fee_paise_snapshot" bigint NOT NULL,
	"agreed_fee_paise_snapshot" bigint NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_package_assignments_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "client_package_assignments_dates_check" CHECK ("client_package_assignments"."effective_to" is null or "client_package_assignments"."effective_to" >= "client_package_assignments"."effective_from"),
	CONSTRAINT "client_package_assignments_status_check" CHECK ("client_package_assignments"."status" in ('scheduled', 'active', 'ended', 'cancelled')),
	CONSTRAINT "client_package_assignments_cycle_check" CHECK ("client_package_assignments"."billing_cycle_snapshot" in ('monthly', 'quarterly', 'annual', 'one_time')),
	CONSTRAINT "client_package_assignments_fee_check" CHECK ("client_package_assignments"."standard_fee_paise_snapshot" >= 0 and "client_package_assignments"."agreed_fee_paise_snapshot" >= 0),
	CONSTRAINT "client_package_assignments_cancellation_check" CHECK (("client_package_assignments"."status" = 'cancelled' and "client_package_assignments"."cancelled_at" is not null and length(trim("client_package_assignments"."cancellation_reason")) > 0) or ("client_package_assignments"."status" <> 'cancelled' and "client_package_assignments"."cancelled_at" is null and "client_package_assignments"."cancellation_reason" = ''))
);
--> statement-breakpoint
CREATE TABLE "service_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_catalog_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "service_catalog_code_check" CHECK ("service_catalog"."code" ~ '^[A-Z][A-Z0-9_-]{1,19}$'),
	CONSTRAINT "service_catalog_status_check" CHECK ("service_catalog"."status" in ('active', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "service_package_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"package_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_package_items_package_service_unique" UNIQUE("tenant_id","package_id","service_id")
);
--> statement-breakpoint
CREATE TABLE "service_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"billing_cycle" text NOT NULL,
	"standard_fee_paise" bigint NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_packages_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "service_packages_code_check" CHECK ("service_packages"."code" ~ '^[A-Z][A-Z0-9_-]{1,19}$'),
	CONSTRAINT "service_packages_billing_cycle_check" CHECK ("service_packages"."billing_cycle" in ('monthly', 'quarterly', 'annual', 'one_time')),
	CONSTRAINT "service_packages_fee_check" CHECK ("service_packages"."standard_fee_paise" >= 0),
	CONSTRAINT "service_packages_status_check" CHECK ("service_packages"."status" in ('active', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "client_package_assignment_services" ADD CONSTRAINT "client_package_assignment_services_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_package_assignment_services" ADD CONSTRAINT "client_package_assignment_services_assignment_tenant_fk" FOREIGN KEY ("tenant_id","assignment_id") REFERENCES "public"."client_package_assignments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_package_assignment_services" ADD CONSTRAINT "client_package_assignment_services_service_tenant_fk" FOREIGN KEY ("tenant_id","service_id") REFERENCES "public"."service_catalog"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_package_assignments" ADD CONSTRAINT "client_package_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_package_assignments" ADD CONSTRAINT "client_package_assignments_entity_tenant_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "public"."legal_entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_package_assignments" ADD CONSTRAINT "client_package_assignments_package_tenant_fk" FOREIGN KEY ("tenant_id","package_id") REFERENCES "public"."service_packages"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_package_assignments" ADD CONSTRAINT "client_package_assignments_creator_membership_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_catalog" ADD CONSTRAINT "service_catalog_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_package_items" ADD CONSTRAINT "service_package_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_package_items" ADD CONSTRAINT "service_package_items_package_tenant_fk" FOREIGN KEY ("tenant_id","package_id") REFERENCES "public"."service_packages"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_package_items" ADD CONSTRAINT "service_package_items_service_tenant_fk" FOREIGN KEY ("tenant_id","service_id") REFERENCES "public"."service_catalog"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_packages" ADD CONSTRAINT "service_packages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_package_assignment_services_assignment_idx" ON "client_package_assignment_services" USING btree ("tenant_id","assignment_id");--> statement-breakpoint
CREATE INDEX "client_package_assignments_entity_dates_idx" ON "client_package_assignments" USING btree ("tenant_id","legal_entity_id","effective_from","effective_to");--> statement-breakpoint
CREATE INDEX "client_package_assignments_tenant_status_idx" ON "client_package_assignments" USING btree ("tenant_id","status","effective_to");--> statement-breakpoint
CREATE UNIQUE INDEX "service_catalog_tenant_code_lower_unique" ON "service_catalog" USING btree ("tenant_id",lower("code"));--> statement-breakpoint
CREATE INDEX "service_catalog_tenant_status_idx" ON "service_catalog" USING btree ("tenant_id","status","name");--> statement-breakpoint
CREATE INDEX "service_package_items_package_idx" ON "service_package_items" USING btree ("tenant_id","package_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_packages_tenant_code_lower_unique" ON "service_packages" USING btree ("tenant_id",lower("code"));--> statement-breakpoint
CREATE INDEX "service_packages_tenant_status_idx" ON "service_packages" USING btree ("tenant_id","status","name");