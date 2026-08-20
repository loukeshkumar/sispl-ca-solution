CREATE TABLE "employee_bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_user_id" uuid NOT NULL,
	"account_holder_name" text NOT NULL,
	"account_number" text NOT NULL,
	"ifsc_code" text NOT NULL,
	"bank_name" text NOT NULL,
	"account_type" text DEFAULT 'savings' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"recorded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_bank_accounts_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "employee_bank_accounts_holder_check" CHECK (length(trim("employee_bank_accounts"."account_holder_name")) between 2 and 120),
	CONSTRAINT "employee_bank_accounts_number_check" CHECK ("employee_bank_accounts"."account_number" ~ '^[0-9]{5,20}$'),
	CONSTRAINT "employee_bank_accounts_ifsc_check" CHECK ("employee_bank_accounts"."ifsc_code" ~ '^[A-Z]{4}0[A-Z0-9]{6}$'),
	CONSTRAINT "employee_bank_accounts_bank_check" CHECK (length(trim("employee_bank_accounts"."bank_name")) between 2 and 120),
	CONSTRAINT "employee_bank_accounts_type_check" CHECK ("employee_bank_accounts"."account_type" in ('savings', 'current')),
	CONSTRAINT "employee_bank_accounts_status_check" CHECK ("employee_bank_accounts"."status" in ('active', 'inactive'))
);
--> statement-breakpoint
CREATE TABLE "payroll_disbursements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payroll_run_id" uuid NOT NULL,
	"batch_reference" text NOT NULL,
	"payment_date" date NOT NULL,
	"instruction_count" integer NOT NULL,
	"total_amount_paise" bigint NOT NULL,
	"excluded_count" integer DEFAULT 0 NOT NULL,
	"generated_by_user_id" uuid NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_disbursements_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "payroll_disbursements_reference_check" CHECK ("payroll_disbursements"."batch_reference" ~ '^[A-Z0-9-]{6,40}$'),
	CONSTRAINT "payroll_disbursements_counts_check" CHECK ("payroll_disbursements"."instruction_count" >= 0 and "payroll_disbursements"."excluded_count" >= 0),
	CONSTRAINT "payroll_disbursements_total_check" CHECK ("payroll_disbursements"."total_amount_paise" >= 0)
);
--> statement-breakpoint
ALTER TABLE "employee_bank_accounts" ADD CONSTRAINT "employee_bank_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_bank_accounts" ADD CONSTRAINT "employee_bank_accounts_employee_membership_fk" FOREIGN KEY ("tenant_id","employee_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_bank_accounts" ADD CONSTRAINT "employee_bank_accounts_recorder_membership_fk" FOREIGN KEY ("tenant_id","recorded_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_disbursements" ADD CONSTRAINT "payroll_disbursements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_disbursements" ADD CONSTRAINT "payroll_disbursements_run_tenant_fk" FOREIGN KEY ("tenant_id","payroll_run_id") REFERENCES "public"."payroll_runs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_disbursements" ADD CONSTRAINT "payroll_disbursements_generator_membership_fk" FOREIGN KEY ("tenant_id","generated_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_bank_accounts_active_unique" ON "employee_bank_accounts" USING btree ("tenant_id","employee_user_id") WHERE "employee_bank_accounts"."status" = 'active';--> statement-breakpoint
CREATE INDEX "employee_bank_accounts_employee_idx" ON "employee_bank_accounts" USING btree ("tenant_id","employee_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_disbursements_batch_unique" ON "payroll_disbursements" USING btree ("tenant_id",upper("batch_reference"));--> statement-breakpoint
CREATE INDEX "payroll_disbursements_run_idx" ON "payroll_disbursements" USING btree ("tenant_id","payroll_run_id","generated_at");