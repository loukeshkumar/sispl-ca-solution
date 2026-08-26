CREATE TABLE "cpe_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"category" text NOT NULL,
	"effective_from" date NOT NULL,
	"yearly_structured_minutes" integer NOT NULL,
	"yearly_total_minutes" integer NOT NULL,
	"block_years" integer DEFAULT 3 NOT NULL,
	"block_structured_minutes" integer NOT NULL,
	"block_total_minutes" integer NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cpe_policies_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "cpe_policies_category_effective_unique" UNIQUE("tenant_id","category","effective_from"),
	CONSTRAINT "cpe_policies_category_check" CHECK ("cpe_policies"."category" in ('in_practice', 'not_in_practice', 'exempt')),
	CONSTRAINT "cpe_policies_block_years_check" CHECK ("cpe_policies"."block_years" between 1 and 10),
	CONSTRAINT "cpe_policies_yearly_check" CHECK ("cpe_policies"."yearly_structured_minutes" between 0 and 120000 and "cpe_policies"."yearly_total_minutes" between 0 and 120000 and "cpe_policies"."yearly_structured_minutes" <= "cpe_policies"."yearly_total_minutes"),
	CONSTRAINT "cpe_policies_block_check" CHECK ("cpe_policies"."block_structured_minutes" between 0 and 600000 and "cpe_policies"."block_total_minutes" between 0 and 600000 and "cpe_policies"."block_structured_minutes" <= "cpe_policies"."block_total_minutes"),
	CONSTRAINT "cpe_policies_note_check" CHECK (length("cpe_policies"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "training_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"provider" text DEFAULT '' NOT NULL,
	"learning_type" text NOT NULL,
	"completed_on" date NOT NULL,
	"minutes" integer NOT NULL,
	"service_code" text DEFAULT '' NOT NULL,
	"certificate_reference" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"recorded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_records_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "training_records_type_check" CHECK ("training_records"."learning_type" in ('structured', 'unstructured', 'course')),
	CONSTRAINT "training_records_title_check" CHECK (length(trim("training_records"."title")) between 2 and 200),
	CONSTRAINT "training_records_minutes_check" CHECK ("training_records"."minutes" between 1 and 12000),
	CONSTRAINT "training_records_service_check" CHECK ("training_records"."service_code" = '' or "training_records"."service_code" ~ '^[A-Z0-9][A-Z0-9_-]{1,19}$'),
	CONSTRAINT "training_records_text_check" CHECK (length("training_records"."provider") <= 160 and length("training_records"."certificate_reference") <= 80 and length("training_records"."note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "cpe_category" text DEFAULT 'in_practice' NOT NULL;--> statement-breakpoint
ALTER TABLE "cpe_policies" ADD CONSTRAINT "cpe_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cpe_policies" ADD CONSTRAINT "cpe_policies_creator_membership_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_employee_membership_fk" FOREIGN KEY ("tenant_id","employee_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_records" ADD CONSTRAINT "training_records_recorder_membership_fk" FOREIGN KEY ("tenant_id","recorded_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cpe_policies_lookup_idx" ON "cpe_policies" USING btree ("tenant_id","category","effective_from");--> statement-breakpoint
CREATE INDEX "training_records_employee_date_idx" ON "training_records" USING btree ("tenant_id","employee_user_id","completed_on");--> statement-breakpoint
CREATE INDEX "training_records_service_idx" ON "training_records" USING btree ("tenant_id","service_code");--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_cpe_category_check" CHECK ("employee_profiles"."cpe_category" in ('in_practice', 'not_in_practice', 'exempt'));