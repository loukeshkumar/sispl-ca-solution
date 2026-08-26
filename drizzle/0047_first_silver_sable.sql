CREATE TABLE "timesheet_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_user_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_minutes" integer,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text DEFAULT '' NOT NULL,
	"reopened_by_user_id" uuid,
	"reopened_at" timestamp with time zone,
	"reopen_reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timesheet_periods_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "timesheet_periods_employee_period_unique" UNIQUE("tenant_id","employee_user_id","period_key"),
	CONSTRAINT "timesheet_periods_period_check" CHECK ("timesheet_periods"."period_key" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "timesheet_periods_status_check" CHECK ("timesheet_periods"."status" in ('open', 'submitted', 'approved')),
	CONSTRAINT "timesheet_periods_state_check" CHECK (
    ("timesheet_periods"."status" = 'open' and "timesheet_periods"."decided_at" is null)
    or ("timesheet_periods"."status" = 'submitted' and "timesheet_periods"."submitted_at" is not null and "timesheet_periods"."decided_at" is null)
    or ("timesheet_periods"."status" = 'approved' and "timesheet_periods"."submitted_at" is not null and "timesheet_periods"."decided_at" is not null and "timesheet_periods"."decided_by_user_id" is not null)
  ),
	CONSTRAINT "timesheet_periods_self_approval_check" CHECK ("timesheet_periods"."decided_by_user_id" is null or "timesheet_periods"."decided_by_user_id" <> "timesheet_periods"."employee_user_id"),
	CONSTRAINT "timesheet_periods_reopen_pair_check" CHECK (("timesheet_periods"."reopened_at" is null and "timesheet_periods"."reopened_by_user_id" is null) or ("timesheet_periods"."reopened_at" is not null and "timesheet_periods"."reopened_by_user_id" is not null and length(trim("timesheet_periods"."reopen_reason")) > 0)),
	CONSTRAINT "timesheet_periods_note_check" CHECK (length("timesheet_periods"."decision_note") <= 500 and length("timesheet_periods"."reopen_reason") <= 500),
	CONSTRAINT "timesheet_periods_submitted_minutes_check" CHECK ("timesheet_periods"."submitted_minutes" is null or "timesheet_periods"."submitted_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "timesheet_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"backdate_window_days" integer DEFAULT 14 NOT NULL,
	"allow_future_dates" boolean DEFAULT false NOT NULL,
	"expected_monthly_minutes" integer,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timesheet_policies_tenant_effective_unique" UNIQUE("tenant_id","effective_from"),
	CONSTRAINT "timesheet_policies_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "timesheet_policies_effective_month_check" CHECK (extract(day from "timesheet_policies"."effective_from") = 1),
	CONSTRAINT "timesheet_policies_window_check" CHECK ("timesheet_policies"."backdate_window_days" between 0 and 365),
	CONSTRAINT "timesheet_policies_expected_check" CHECK ("timesheet_policies"."expected_monthly_minutes" is null or "timesheet_policies"."expected_monthly_minutes" between 60 and 30000)
);
--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "recorded_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "backdate_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "timesheet_periods" ADD CONSTRAINT "timesheet_periods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_periods" ADD CONSTRAINT "timesheet_periods_employee_membership_fk" FOREIGN KEY ("tenant_id","employee_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_periods" ADD CONSTRAINT "timesheet_periods_decider_membership_fk" FOREIGN KEY ("tenant_id","decided_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_periods" ADD CONSTRAINT "timesheet_periods_reopener_membership_fk" FOREIGN KEY ("tenant_id","reopened_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_policies" ADD CONSTRAINT "timesheet_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_policies" ADD CONSTRAINT "timesheet_policies_creator_membership_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "timesheet_periods_status_idx" ON "timesheet_periods" USING btree ("tenant_id","status","period_key");--> statement-breakpoint
CREATE INDEX "timesheet_periods_period_idx" ON "timesheet_periods" USING btree ("tenant_id","period_key");--> statement-breakpoint
CREATE INDEX "timesheet_policies_tenant_effective_idx" ON "timesheet_policies" USING btree ("tenant_id","effective_from");--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_recorder_membership_fk" FOREIGN KEY ("tenant_id","recorded_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_backdate_reason_check" CHECK (length("time_entries"."backdate_reason") <= 500);