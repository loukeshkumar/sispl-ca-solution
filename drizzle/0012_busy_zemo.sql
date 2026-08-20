ALTER TABLE "attendance_period_summaries" DROP CONSTRAINT "attendance_summaries_units_check";--> statement-breakpoint
ALTER TABLE "payroll_entries" DROP CONSTRAINT "payroll_entries_units_check";--> statement-breakpoint
ALTER TABLE "payroll_entries" DROP CONSTRAINT "payroll_entries_money_check";--> statement-breakpoint
ALTER TABLE "payroll_entry_lines" DROP CONSTRAINT "payroll_entry_lines_source_check";--> statement-breakpoint
ALTER TABLE "attendance_period_summaries" ADD COLUMN "period_scheduled_half_days" integer;--> statement-breakpoint
ALTER TABLE "attendance_period_summaries" ADD COLUMN "employment_excluded_half_days" integer;--> statement-breakpoint
ALTER TABLE "attendance_periods" ADD COLUMN "policy_id" uuid;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD COLUMN "period_scheduled_half_days" integer;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD COLUMN "employment_excluded_half_days" integer;--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD COLUMN "employment_proration_deduction_paise" bigint;--> statement-breakpoint
UPDATE "attendance_period_summaries"
SET "period_scheduled_half_days" = "scheduled_half_days",
    "employment_excluded_half_days" = 0;--> statement-breakpoint
UPDATE "payroll_entries"
SET "period_scheduled_half_days" = "scheduled_half_days",
    "employment_excluded_half_days" = 0,
    "employment_proration_deduction_paise" = 0;--> statement-breakpoint
UPDATE "attendance_periods"
SET "policy_id" = (
  SELECT "attendance_policies"."id"
  FROM "attendance_policies"
  WHERE "attendance_policies"."tenant_id" = "attendance_periods"."tenant_id"
    AND "attendance_policies"."effective_from" <= (("attendance_periods"."period_key" || '-01')::date + interval '1 month - 1 day')::date
  ORDER BY "attendance_policies"."effective_from" DESC
  LIMIT 1
)
WHERE "attendance_periods"."status" = 'locked' AND "attendance_periods"."policy_id" IS NULL;--> statement-breakpoint
ALTER TABLE "attendance_period_summaries" ALTER COLUMN "period_scheduled_half_days" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_period_summaries" ALTER COLUMN "employment_excluded_half_days" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_entries" ALTER COLUMN "period_scheduled_half_days" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_entries" ALTER COLUMN "employment_excluded_half_days" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "payroll_entries" ALTER COLUMN "employment_proration_deduction_paise" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_periods" ADD CONSTRAINT "attendance_periods_policy_tenant_fk" FOREIGN KEY ("tenant_id","policy_id") REFERENCES "public"."attendance_policies"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_period_summaries" ADD CONSTRAINT "attendance_summaries_units_check" CHECK ("attendance_period_summaries"."period_scheduled_half_days" > 0 and "attendance_period_summaries"."scheduled_half_days" >= 0 and "attendance_period_summaries"."employment_excluded_half_days" >= 0 and "attendance_period_summaries"."scheduled_half_days" + "attendance_period_summaries"."employment_excluded_half_days" = "attendance_period_summaries"."period_scheduled_half_days" and "attendance_period_summaries"."payable_half_days" >= 0 and "attendance_period_summaries"."lop_half_days" >= 0 and "attendance_period_summaries"."payable_half_days" + "attendance_period_summaries"."lop_half_days" = "attendance_period_summaries"."scheduled_half_days" and "attendance_period_summaries"."present_days" >= 0 and "attendance_period_summaries"."paid_leave_half_days" >= 0 and "attendance_period_summaries"."unpaid_leave_half_days" >= 0 and "attendance_period_summaries"."absence_half_days" >= 0 and "attendance_period_summaries"."overtime_minutes" >= 0 and "attendance_period_summaries"."late_count" >= 0);--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_units_check" CHECK ("payroll_entries"."period_scheduled_half_days" > 0 and "payroll_entries"."scheduled_half_days" >= 0 and "payroll_entries"."employment_excluded_half_days" >= 0 and "payroll_entries"."scheduled_half_days" + "payroll_entries"."employment_excluded_half_days" = "payroll_entries"."period_scheduled_half_days" and "payroll_entries"."payable_half_days" >= 0 and "payroll_entries"."lop_half_days" >= 0 and "payroll_entries"."payable_half_days" + "payroll_entries"."lop_half_days" = "payroll_entries"."scheduled_half_days");--> statement-breakpoint
ALTER TABLE "payroll_entries" ADD CONSTRAINT "payroll_entries_money_check" CHECK ("payroll_entries"."full_gross_paise" >= 0 and "payroll_entries"."earned_gross_paise" >= 0 and "payroll_entries"."employment_proration_deduction_paise" >= 0 and "payroll_entries"."attendance_deduction_paise" >= 0 and "payroll_entries"."recurring_deduction_paise" >= 0 and "payroll_entries"."one_time_addition_paise" >= 0 and "payroll_entries"."one_time_deduction_paise" >= 0 and "payroll_entries"."employee_provident_fund_paise" >= 0 and "payroll_entries"."employee_state_insurance_paise" >= 0 and "payroll_entries"."professional_tax_paise" >= 0 and "payroll_entries"."income_tax_paise" >= 0 and "payroll_entries"."total_deductions_paise" >= 0 and "payroll_entries"."net_pay_paise" >= 0 and "payroll_entries"."employer_cost_paise" >= 0);--> statement-breakpoint
ALTER TABLE "payroll_entry_lines" ADD CONSTRAINT "payroll_entry_lines_source_check" CHECK ("payroll_entry_lines"."source" in ('salary_structure', 'employment', 'attendance', 'adjustment', 'statutory'));
