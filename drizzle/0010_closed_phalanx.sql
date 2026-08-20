CREATE TABLE "attendance_correction_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_user_id" uuid NOT NULL,
	"attendance_date" date NOT NULL,
	"source_attendance_day_id" uuid,
	"source_version" integer DEFAULT 0 NOT NULL,
	"original_snapshot" text NOT NULL,
	"proposed_status" text NOT NULL,
	"proposed_check_in" timestamp with time zone,
	"proposed_check_out" timestamp with time zone,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewer_user_id" uuid,
	"decision_note" text DEFAULT '' NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_corrections_status_value_check" CHECK ("attendance_correction_requests"."proposed_status" in ('present', 'absent', 'leave', 'half_day', 'late', 'missing_punch', 'weekly_off', 'holiday', 'wfh', 'tour')),
	CONSTRAINT "attendance_corrections_status_check" CHECK ("attendance_correction_requests"."status" in ('pending', 'approved', 'rejected', 'cancelled')),
	CONSTRAINT "attendance_corrections_version_check" CHECK ("attendance_correction_requests"."source_version" >= 0),
	CONSTRAINT "attendance_corrections_time_check" CHECK ("attendance_correction_requests"."proposed_check_in" is null or "attendance_correction_requests"."proposed_check_out" is null or "attendance_correction_requests"."proposed_check_out" > "attendance_correction_requests"."proposed_check_in"),
	CONSTRAINT "attendance_corrections_reviewer_check" CHECK ("attendance_correction_requests"."reviewer_user_id" is null or "attendance_correction_requests"."reviewer_user_id" <> "attendance_correction_requests"."employee_user_id")
);
--> statement-breakpoint
CREATE TABLE "attendance_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_user_id" uuid NOT NULL,
	"attendance_date" date NOT NULL,
	"status" text NOT NULL,
	"first_check_in" timestamp with time zone,
	"last_check_out" timestamp with time zone,
	"worked_minutes" integer DEFAULT 0 NOT NULL,
	"late_minutes" integer DEFAULT 0 NOT NULL,
	"paid_half_days" integer DEFAULT 0 NOT NULL,
	"lop_half_days" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'self_service' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_days_tenant_employee_date_unique" UNIQUE("tenant_id","employee_user_id","attendance_date"),
	CONSTRAINT "attendance_days_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "attendance_days_status_check" CHECK ("attendance_days"."status" in ('present', 'absent', 'leave', 'half_day', 'late', 'missing_punch', 'weekly_off', 'holiday', 'wfh', 'tour')),
	CONSTRAINT "attendance_days_minutes_check" CHECK ("attendance_days"."worked_minutes" >= 0 and "attendance_days"."late_minutes" >= 0 and "attendance_days"."paid_half_days" between 0 and 2 and "attendance_days"."lop_half_days" between 0 and 2),
	CONSTRAINT "attendance_days_time_order_check" CHECK ("attendance_days"."first_check_in" is null or "attendance_days"."last_check_out" is null or "attendance_days"."last_check_out" > "attendance_days"."first_check_in"),
	CONSTRAINT "attendance_days_version_check" CHECK ("attendance_days"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "attendance_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"attendance_day_id" uuid NOT NULL,
	"employee_user_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_events_type_check" CHECK ("attendance_events"."event_type" in ('check_in', 'check_out', 'manual_record', 'leave_approved', 'correction_approved')),
	CONSTRAINT "attendance_events_source_check" CHECK ("attendance_events"."source" in ('self_service', 'manager', 'administrator', 'system'))
);
--> statement-breakpoint
CREATE TABLE "attendance_period_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"attendance_period_id" uuid NOT NULL,
	"employee_user_id" uuid NOT NULL,
	"scheduled_half_days" integer NOT NULL,
	"payable_half_days" integer NOT NULL,
	"lop_half_days" integer NOT NULL,
	"present_days" integer NOT NULL,
	"paid_leave_half_days" integer NOT NULL,
	"unpaid_leave_half_days" integer NOT NULL,
	"absence_half_days" integer NOT NULL,
	"overtime_minutes" integer NOT NULL,
	"late_count" integer NOT NULL,
	"source_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_summaries_period_employee_unique" UNIQUE("tenant_id","attendance_period_id","employee_user_id"),
	CONSTRAINT "attendance_summaries_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "attendance_summaries_units_check" CHECK ("attendance_period_summaries"."scheduled_half_days" >= 0 and "attendance_period_summaries"."payable_half_days" >= 0 and "attendance_period_summaries"."lop_half_days" >= 0 and "attendance_period_summaries"."payable_half_days" + "attendance_period_summaries"."lop_half_days" = "attendance_period_summaries"."scheduled_half_days" and "attendance_period_summaries"."present_days" >= 0 and "attendance_period_summaries"."paid_leave_half_days" >= 0 and "attendance_period_summaries"."unpaid_leave_half_days" >= 0 and "attendance_period_summaries"."absence_half_days" >= 0 and "attendance_period_summaries"."overtime_minutes" >= 0 and "attendance_period_summaries"."late_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "attendance_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_user_id" uuid,
	"locked_at" timestamp with time zone,
	"locked_by_user_id" uuid,
	"reopen_reason" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_periods_tenant_period_unique" UNIQUE("tenant_id","period_key"),
	CONSTRAINT "attendance_periods_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "attendance_periods_period_check" CHECK ("attendance_periods"."period_key" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "attendance_periods_status_check" CHECK ("attendance_periods"."status" in ('open', 'review', 'locked')),
	CONSTRAINT "attendance_periods_locked_state_check" CHECK (("attendance_periods"."status" = 'open' and "attendance_periods"."reviewed_at" is null and "attendance_periods"."locked_at" is null) or ("attendance_periods"."status" = 'review' and "attendance_periods"."reviewed_at" is not null and "attendance_periods"."locked_at" is null) or ("attendance_periods"."status" = 'locked' and "attendance_periods"."reviewed_at" is not null and "attendance_periods"."locked_at" is not null and "attendance_periods"."locked_by_user_id" is not null)),
	CONSTRAINT "attendance_periods_version_check" CHECK ("attendance_periods"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "attendance_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"jurisdiction_state" text DEFAULT 'Bihar' NOT NULL,
	"time_zone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"working_week_mask" text DEFAULT '1111110' NOT NULL,
	"standard_start_time" text DEFAULT '09:30' NOT NULL,
	"standard_end_time" text DEFAULT '18:00' NOT NULL,
	"late_grace_minutes" integer DEFAULT 15 NOT NULL,
	"full_day_minutes" integer DEFAULT 450 NOT NULL,
	"half_day_minutes" integer DEFAULT 225 NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_policies_tenant_effective_unique" UNIQUE("tenant_id","effective_from"),
	CONSTRAINT "attendance_policies_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "attendance_policies_week_mask_check" CHECK ("attendance_policies"."working_week_mask" ~ '^[01]{7}$' and "attendance_policies"."working_week_mask" like '%1%'),
	CONSTRAINT "attendance_policies_time_check" CHECK ("attendance_policies"."standard_start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and "attendance_policies"."standard_end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and "attendance_policies"."standard_start_time" < "attendance_policies"."standard_end_time"),
	CONSTRAINT "attendance_policies_minutes_check" CHECK ("attendance_policies"."late_grace_minutes" between 0 and 180 and "attendance_policies"."full_day_minutes" between 60 and 960 and "attendance_policies"."half_day_minutes" between 30 and "attendance_policies"."full_day_minutes" - 1)
);
--> statement-breakpoint
CREATE TABLE "employee_work_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_user_id" uuid NOT NULL,
	"manager_user_id" uuid,
	"employment_type" text DEFAULT 'employee' NOT NULL,
	"work_location_state" text DEFAULT 'Bihar' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_work_profiles_tenant_employee_unique" UNIQUE("tenant_id","employee_user_id"),
	CONSTRAINT "employee_work_profiles_type_check" CHECK ("employee_work_profiles"."employment_type" in ('employee', 'articled_assistant')),
	CONSTRAINT "employee_work_profiles_manager_check" CHECK ("employee_work_profiles"."manager_user_id" is null or "employee_work_profiles"."manager_user_id" <> "employee_work_profiles"."employee_user_id")
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_user_id" uuid NOT NULL,
	"date_from" date NOT NULL,
	"date_to" date NOT NULL,
	"leave_type" text NOT NULL,
	"day_portion" text DEFAULT 'full' NOT NULL,
	"paid_classification" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewer_user_id" uuid,
	"decision_note" text DEFAULT '' NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_requests_date_check" CHECK ("leave_requests"."date_to" >= "leave_requests"."date_from"),
	CONSTRAINT "leave_requests_type_check" CHECK ("leave_requests"."leave_type" in ('casual', 'sick', 'earned', 'maternity', 'compensatory', 'other')),
	CONSTRAINT "leave_requests_portion_check" CHECK ("leave_requests"."day_portion" in ('full', 'first_half', 'second_half')),
	CONSTRAINT "leave_requests_paid_check" CHECK ("leave_requests"."paid_classification" in ('paid', 'unpaid')),
	CONSTRAINT "leave_requests_status_check" CHECK ("leave_requests"."status" in ('pending', 'approved', 'rejected', 'cancelled')),
	CONSTRAINT "leave_requests_reviewer_check" CHECK ("leave_requests"."reviewer_user_id" is null or "leave_requests"."reviewer_user_id" <> "leave_requests"."employee_user_id"),
	CONSTRAINT "leave_requests_decision_check" CHECK (("leave_requests"."status" in ('approved', 'rejected') and "leave_requests"."reviewer_user_id" is not null and "leave_requests"."decided_at" is not null) or ("leave_requests"."status" in ('pending', 'cancelled') and "leave_requests"."decided_at" is null))
);
--> statement-breakpoint
CREATE TABLE "payroll_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payroll_run_id" uuid NOT NULL,
	"employee_user_id" uuid NOT NULL,
	"salary_structure_id" uuid NOT NULL,
	"employee_code_snapshot" text NOT NULL,
	"employee_name_snapshot" text NOT NULL,
	"designation_snapshot" text NOT NULL,
	"scheduled_half_days" integer NOT NULL,
	"payable_half_days" integer NOT NULL,
	"lop_half_days" integer NOT NULL,
	"full_gross_paise" bigint NOT NULL,
	"earned_gross_paise" bigint NOT NULL,
	"attendance_deduction_paise" bigint NOT NULL,
	"recurring_deduction_paise" bigint NOT NULL,
	"one_time_addition_paise" bigint DEFAULT 0 NOT NULL,
	"one_time_deduction_paise" bigint DEFAULT 0 NOT NULL,
	"employee_provident_fund_paise" bigint DEFAULT 0 NOT NULL,
	"employee_state_insurance_paise" bigint DEFAULT 0 NOT NULL,
	"professional_tax_paise" bigint DEFAULT 0 NOT NULL,
	"income_tax_paise" bigint DEFAULT 0 NOT NULL,
	"total_deductions_paise" bigint NOT NULL,
	"net_pay_paise" bigint NOT NULL,
	"employer_cost_paise" bigint NOT NULL,
	"hold" boolean DEFAULT false NOT NULL,
	"hold_reason" text DEFAULT '' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_entries_run_employee_unique" UNIQUE("tenant_id","payroll_run_id","employee_user_id"),
	CONSTRAINT "payroll_entries_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "payroll_entries_units_check" CHECK ("payroll_entries"."scheduled_half_days" >= 0 and "payroll_entries"."payable_half_days" >= 0 and "payroll_entries"."lop_half_days" >= 0 and "payroll_entries"."payable_half_days" + "payroll_entries"."lop_half_days" = "payroll_entries"."scheduled_half_days"),
	CONSTRAINT "payroll_entries_money_check" CHECK ("payroll_entries"."full_gross_paise" >= 0 and "payroll_entries"."earned_gross_paise" >= 0 and "payroll_entries"."attendance_deduction_paise" >= 0 and "payroll_entries"."recurring_deduction_paise" >= 0 and "payroll_entries"."one_time_addition_paise" >= 0 and "payroll_entries"."one_time_deduction_paise" >= 0 and "payroll_entries"."employee_provident_fund_paise" >= 0 and "payroll_entries"."employee_state_insurance_paise" >= 0 and "payroll_entries"."professional_tax_paise" >= 0 and "payroll_entries"."income_tax_paise" >= 0 and "payroll_entries"."total_deductions_paise" >= 0 and "payroll_entries"."net_pay_paise" >= 0 and "payroll_entries"."employer_cost_paise" >= 0),
	CONSTRAINT "payroll_entries_hold_check" CHECK (not "payroll_entries"."hold" or length(trim("payroll_entries"."hold_reason")) > 0)
);
--> statement-breakpoint
CREATE TABLE "payroll_entry_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payroll_entry_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"source" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_entry_lines_entry_code_unique" UNIQUE("tenant_id","payroll_entry_id","code"),
	CONSTRAINT "payroll_entry_lines_kind_check" CHECK ("payroll_entry_lines"."kind" in ('earning', 'deduction', 'employer_contribution')),
	CONSTRAINT "payroll_entry_lines_source_check" CHECK ("payroll_entry_lines"."source" in ('salary_structure', 'attendance', 'adjustment', 'statutory')),
	CONSTRAINT "payroll_entry_lines_amount_check" CHECK ("payroll_entry_lines"."amount_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"attendance_period_id" uuid NOT NULL,
	"period_key" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"pay_date" date NOT NULL,
	"prepared_by_user_id" uuid NOT NULL,
	"submitted_by_user_id" uuid,
	"submitted_at" timestamp with time zone,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"published_by_user_id" uuid,
	"published_at" timestamp with time zone,
	"paid_by_user_id" uuid,
	"paid_at" timestamp with time zone,
	"payment_reference" text DEFAULT '' NOT NULL,
	"transition_reason" text DEFAULT '' NOT NULL,
	"total_gross_paise" bigint DEFAULT 0 NOT NULL,
	"total_deductions_paise" bigint DEFAULT 0 NOT NULL,
	"total_net_paise" bigint DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_runs_tenant_period_unique" UNIQUE("tenant_id","period_key"),
	CONSTRAINT "payroll_runs_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "payroll_runs_period_check" CHECK ("payroll_runs"."period_key" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "payroll_runs_status_check" CHECK ("payroll_runs"."status" in ('draft', 'submitted', 'approved_locked', 'payslips_published', 'paid')),
	CONSTRAINT "payroll_runs_money_check" CHECK ("payroll_runs"."total_gross_paise" >= 0 and "payroll_runs"."total_deductions_paise" >= 0 and "payroll_runs"."total_net_paise" >= 0),
	CONSTRAINT "payroll_runs_state_timestamps_check" CHECK (("payroll_runs"."status" = 'draft' and "payroll_runs"."submitted_at" is null and "payroll_runs"."approved_at" is null and "payroll_runs"."published_at" is null and "payroll_runs"."paid_at" is null) or ("payroll_runs"."status" = 'submitted' and "payroll_runs"."submitted_at" is not null and "payroll_runs"."approved_at" is null and "payroll_runs"."published_at" is null and "payroll_runs"."paid_at" is null) or ("payroll_runs"."status" = 'approved_locked' and "payroll_runs"."submitted_at" is not null and "payroll_runs"."approved_at" is not null and "payroll_runs"."published_at" is null and "payroll_runs"."paid_at" is null) or ("payroll_runs"."status" = 'payslips_published' and "payroll_runs"."submitted_at" is not null and "payroll_runs"."approved_at" is not null and "payroll_runs"."published_at" is not null and "payroll_runs"."paid_at" is null) or ("payroll_runs"."status" = 'paid' and "payroll_runs"."submitted_at" is not null and "payroll_runs"."approved_at" is not null and "payroll_runs"."published_at" is not null and "payroll_runs"."paid_at" is not null)),
	CONSTRAINT "payroll_runs_version_check" CHECK ("payroll_runs"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "salary_structure_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"salary_structure_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"kind" text NOT NULL,
	"monthly_amount_paise" bigint NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "salary_lines_structure_code_unique" UNIQUE("tenant_id","salary_structure_id","code"),
	CONSTRAINT "salary_lines_code_check" CHECK ("salary_structure_lines"."code" ~ '^[A-Z][A-Z0-9_]{1,29}$'),
	CONSTRAINT "salary_lines_kind_check" CHECK ("salary_structure_lines"."kind" in ('earning', 'deduction', 'employer_contribution')),
	CONSTRAINT "salary_lines_amount_check" CHECK ("salary_structure_lines"."monthly_amount_paise" >= 0)
);
--> statement-breakpoint
CREATE TABLE "salary_structures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_user_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salary_structures_employee_effective_unique" UNIQUE("tenant_id","employee_user_id","effective_from"),
	CONSTRAINT "salary_structures_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "salary_structures_status_check" CHECK ("salary_structures"."status" in ('active', 'superseded'))
);
--> statement-breakpoint
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_correction_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_corrections_employee_membership_fk" FOREIGN KEY ("tenant_id","employee_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_corrections_reviewer_membership_fk" FOREIGN KEY ("tenant_id","reviewer_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_correction_requests" ADD CONSTRAINT "attendance_corrections_day_tenant_fk" FOREIGN KEY ("tenant_id","source_attendance_day_id") REFERENCES "public"."attendance_days"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_employee_membership_fk" FOREIGN KEY ("tenant_id","employee_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_day_tenant_fk" FOREIGN KEY ("tenant_id","attendance_day_id") REFERENCES "public"."attendance_days"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_employee_membership_fk" FOREIGN KEY ("tenant_id","employee_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_actor_membership_fk" FOREIGN KEY ("tenant_id","actor_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_period_summaries" ADD CONSTRAINT "attendance_period_summaries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_period_summaries" ADD CONSTRAINT "attendance_summaries_period_tenant_fk" FOREIGN KEY ("tenant_id","attendance_period_id") REFERENCES "public"."attendance_periods"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_period_summaries" ADD CONSTRAINT "attendance_summaries_employee_membership_fk" FOREIGN KEY ("tenant_id","employee_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_periods" ADD CONSTRAINT "attendance_periods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_periods" ADD CONSTRAINT "attendance_periods_reviewer_membership_fk" FOREIGN KEY ("tenant_id","reviewed_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_periods" ADD CONSTRAINT "attendance_periods_locker_membership_fk" FOREIGN KEY ("tenant_id","locked_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_policies" ADD CONSTRAINT "attendance_policies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_policies" ADD CONSTRAINT "attendance_policies_creator_membership_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_work_profiles" ADD CONSTRAINT "employee_work_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_work_profiles" ADD CONSTRAINT "employee_work_profiles_employee_membership_fk" FOREIGN KEY ("tenant_id","employee_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_work_profiles" ADD CONSTRAINT "employee_work_profiles_manager_membership_fk" FOREIGN KEY ("tenant_id","manager_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_membership_fk" FOREIGN KEY ("tenant_id","employee_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_reviewer_membership_fk" FOREIGN KEY ("tenant_id","reviewer_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_run_tenant_fk" FOREIGN KEY ("tenant_id","payroll_run_id") REFERENCES "public"."payroll_runs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_employee_membership_fk" FOREIGN KEY ("tenant_id","employee_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_salary_tenant_fk" FOREIGN KEY ("tenant_id","salary_structure_id") REFERENCES "public"."salary_structures"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_entry_lines" ADD CONSTRAINT "payroll_entry_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_entry_lines" ADD CONSTRAINT "payroll_entry_lines_entry_tenant_fk" FOREIGN KEY ("tenant_id","payroll_entry_id") REFERENCES "public"."payroll_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_attendance_period_tenant_fk" FOREIGN KEY ("tenant_id","attendance_period_id") REFERENCES "public"."attendance_periods"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_preparer_membership_fk" FOREIGN KEY ("tenant_id","prepared_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_submitter_membership_fk" FOREIGN KEY ("tenant_id","submitted_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_approver_membership_fk" FOREIGN KEY ("tenant_id","approved_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_publisher_membership_fk" FOREIGN KEY ("tenant_id","published_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_payer_membership_fk" FOREIGN KEY ("tenant_id","paid_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structure_lines" ADD CONSTRAINT "salary_structure_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structure_lines" ADD CONSTRAINT "salary_lines_structure_tenant_fk" FOREIGN KEY ("tenant_id","salary_structure_id") REFERENCES "public"."salary_structures"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_employee_membership_fk" FOREIGN KEY ("tenant_id","employee_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_structures" ADD CONSTRAINT "salary_structures_creator_membership_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_corrections_pending_unique" ON "attendance_correction_requests" USING btree ("tenant_id","employee_user_id","attendance_date") WHERE "attendance_correction_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "attendance_corrections_tenant_status_idx" ON "attendance_correction_requests" USING btree ("tenant_id","status","attendance_date");--> statement-breakpoint
CREATE INDEX "attendance_days_tenant_date_idx" ON "attendance_days" USING btree ("tenant_id","attendance_date");--> statement-breakpoint
CREATE INDEX "attendance_events_day_idx" ON "attendance_events" USING btree ("tenant_id","attendance_day_id","occurred_at");--> statement-breakpoint
CREATE INDEX "attendance_summaries_employee_idx" ON "attendance_period_summaries" USING btree ("tenant_id","employee_user_id","attendance_period_id");--> statement-breakpoint
CREATE INDEX "attendance_periods_tenant_status_idx" ON "attendance_periods" USING btree ("tenant_id","status","period_key");--> statement-breakpoint
CREATE INDEX "attendance_policies_tenant_effective_idx" ON "attendance_policies" USING btree ("tenant_id","effective_from");--> statement-breakpoint
CREATE INDEX "employee_work_profiles_manager_idx" ON "employee_work_profiles" USING btree ("tenant_id","manager_user_id");--> statement-breakpoint
CREATE INDEX "leave_requests_tenant_status_idx" ON "leave_requests" USING btree ("tenant_id","status","date_from");--> statement-breakpoint
CREATE INDEX "payroll_entries_employee_idx" ON "payroll_entries" USING btree ("tenant_id","employee_user_id","payroll_run_id");--> statement-breakpoint
CREATE INDEX "payroll_entry_lines_entry_idx" ON "payroll_entry_lines" USING btree ("tenant_id","payroll_entry_id");--> statement-breakpoint
CREATE INDEX "payroll_runs_tenant_status_idx" ON "payroll_runs" USING btree ("tenant_id","status","period_key");--> statement-breakpoint
CREATE INDEX "salary_lines_structure_idx" ON "salary_structure_lines" USING btree ("tenant_id","salary_structure_id","display_order");--> statement-breakpoint
CREATE INDEX "salary_structures_employee_effective_idx" ON "salary_structures" USING btree ("tenant_id","employee_user_id","effective_from");