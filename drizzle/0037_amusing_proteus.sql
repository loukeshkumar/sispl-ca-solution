CREATE TABLE "articleship_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"training_months" integer NOT NULL,
	"leave_fraction_numerator" integer DEFAULT 1 NOT NULL,
	"leave_fraction_denominator" integer DEFAULT 6 NOT NULL,
	"confirmed" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "articleship_policies_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "articleship_policies_effective_unique" UNIQUE("tenant_id","effective_from"),
	CONSTRAINT "articleship_policies_months_check" CHECK ("articleship_policies"."training_months" between 1 and 60),
	CONSTRAINT "articleship_policies_fraction_check" CHECK ("articleship_policies"."leave_fraction_numerator" between 1 and 100 and "articleship_policies"."leave_fraction_denominator" between 1 and 100 and "articleship_policies"."leave_fraction_numerator" <= "articleship_policies"."leave_fraction_denominator"),
	CONSTRAINT "articleship_policies_note_check" CHECK (length("articleship_policies"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "articleship_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"article_user_id" uuid NOT NULL,
	"principal_user_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"commenced_on" date NOT NULL,
	"training_months" integer NOT NULL,
	"registration_number" text DEFAULT '' NOT NULL,
	"deed_date" date,
	"form_103_date" date,
	"form_109_date" date,
	"form_108_date" date,
	"ended_on" date,
	"end_reason" text DEFAULT '' NOT NULL,
	"industrial_training_from" date,
	"industrial_training_to" date,
	"industrial_training_employer" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "articleship_registrations_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "articleship_status_check" CHECK ("articleship_registrations"."status" in ('active', 'transferred', 'terminated', 'completed')),
	CONSTRAINT "articleship_months_check" CHECK ("articleship_registrations"."training_months" between 1 and 60),
	CONSTRAINT "articleship_principal_check" CHECK ("articleship_registrations"."principal_user_id" <> "articleship_registrations"."article_user_id"),
	CONSTRAINT "articleship_ended_state_check" CHECK (("articleship_registrations"."status" = 'active' and "articleship_registrations"."ended_on" is null) or ("articleship_registrations"."status" <> 'active' and "articleship_registrations"."ended_on" is not null)),
	CONSTRAINT "articleship_ended_order_check" CHECK ("articleship_registrations"."ended_on" is null or "articleship_registrations"."ended_on" >= "articleship_registrations"."commenced_on"),
	CONSTRAINT "articleship_completed_form_check" CHECK ("articleship_registrations"."status" <> 'completed' or "articleship_registrations"."form_108_date" is not null),
	CONSTRAINT "articleship_industrial_range_check" CHECK (("articleship_registrations"."industrial_training_from" is null) = ("articleship_registrations"."industrial_training_to" is null) and ("articleship_registrations"."industrial_training_to" is null or "articleship_registrations"."industrial_training_to" >= "articleship_registrations"."industrial_training_from")),
	CONSTRAINT "articleship_text_check" CHECK (length("articleship_registrations"."registration_number") <= 40 and length("articleship_registrations"."end_reason") <= 300 and length("articleship_registrations"."industrial_training_employer") <= 160 and length("articleship_registrations"."note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "articleship_policies" ADD CONSTRAINT "articleship_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articleship_policies" ADD CONSTRAINT "articleship_policies_creator_membership_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articleship_registrations" ADD CONSTRAINT "articleship_registrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articleship_registrations" ADD CONSTRAINT "articleship_article_membership_fk" FOREIGN KEY ("tenant_id","article_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articleship_registrations" ADD CONSTRAINT "articleship_principal_membership_fk" FOREIGN KEY ("tenant_id","principal_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articleship_registrations" ADD CONSTRAINT "articleship_creator_membership_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "articleship_policies_lookup_idx" ON "articleship_policies" USING btree ("tenant_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "articleship_registrations_active_unique" ON "articleship_registrations" USING btree ("tenant_id","article_user_id") WHERE "articleship_registrations"."status" = 'active';--> statement-breakpoint
CREATE INDEX "articleship_registrations_status_idx" ON "articleship_registrations" USING btree ("tenant_id","status","commenced_on");--> statement-breakpoint
CREATE INDEX "articleship_registrations_principal_idx" ON "articleship_registrations" USING btree ("tenant_id","principal_user_id","status");