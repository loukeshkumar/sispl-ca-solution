CREATE TABLE "employee_capabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_user_id" uuid NOT NULL,
	"service_code" text NOT NULL,
	"level" text NOT NULL,
	"assessed_by_user_id" uuid NOT NULL,
	"assessed_on" date NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_capabilities_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "employee_capabilities_employee_service_unique" UNIQUE("tenant_id","employee_user_id","service_code"),
	CONSTRAINT "employee_capabilities_service_code_check" CHECK ("employee_capabilities"."service_code" ~ '^[A-Z0-9][A-Z0-9_-]{1,19}$'),
	CONSTRAINT "employee_capabilities_level_check" CHECK ("employee_capabilities"."level" in ('learning', 'prepare', 'review', 'sign')),
	CONSTRAINT "employee_capabilities_note_check" CHECK (length("employee_capabilities"."note") <= 500),
	CONSTRAINT "employee_capabilities_assessor_check" CHECK ("employee_capabilities"."assessed_by_user_id" <> "employee_capabilities"."employee_user_id")
);
--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "qualification" text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "membership_number" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "qualified_on" date;--> statement-breakpoint
ALTER TABLE "employee_capabilities" ADD CONSTRAINT "employee_capabilities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_capabilities" ADD CONSTRAINT "employee_capabilities_employee_membership_fk" FOREIGN KEY ("tenant_id","employee_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_capabilities" ADD CONSTRAINT "employee_capabilities_assessor_membership_fk" FOREIGN KEY ("tenant_id","assessed_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_capabilities_service_level_idx" ON "employee_capabilities" USING btree ("tenant_id","service_code","level");--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_qualification_check" CHECK ("employee_profiles"."qualification" in ('ca', 'cma', 'cs', 'llb', 'ca_inter', 'articled', 'other'));--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_membership_check" CHECK ("employee_profiles"."membership_number" = '' or ("employee_profiles"."qualification" = 'ca' and "employee_profiles"."membership_number" ~ '^[0-9]{6}$'));--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_qualified_on_check" CHECK ("employee_profiles"."qualified_on" is null or "employee_profiles"."qualification" <> 'articled');