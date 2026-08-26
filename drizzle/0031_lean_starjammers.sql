CREATE TABLE "leave_ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_user_id" uuid NOT NULL,
	"leave_type_code" text NOT NULL,
	"leave_year" text NOT NULL,
	"entry_type" text NOT NULL,
	"half_days" integer NOT NULL,
	"effective_date" date NOT NULL,
	"source_type" text DEFAULT '' NOT NULL,
	"source_id" uuid,
	"reason" text DEFAULT '' NOT NULL,
	"actor_user_id" uuid,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_ledger_entries_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "leave_ledger_type_code_check" CHECK ("leave_ledger_entries"."leave_type_code" ~ '^[a-z][a-z0-9_]{1,29}$'),
	CONSTRAINT "leave_ledger_year_check" CHECK ("leave_ledger_entries"."leave_year" ~ '^[0-9]{4}-[0-9]{2}$'),
	CONSTRAINT "leave_ledger_entry_type_check" CHECK ("leave_ledger_entries"."entry_type" in ('opening', 'accrual', 'carry_forward', 'consumption', 'reversal', 'lapse', 'encashment', 'adjustment')),
	CONSTRAINT "leave_ledger_half_days_check" CHECK ("leave_ledger_entries"."half_days" <> 0 and "leave_ledger_entries"."half_days" between -1460 and 1460),
	CONSTRAINT "leave_ledger_direction_check" CHECK (("leave_ledger_entries"."entry_type" in ('opening', 'accrual', 'carry_forward') and "leave_ledger_entries"."half_days" > 0) or ("leave_ledger_entries"."entry_type" in ('consumption', 'lapse', 'encashment') and "leave_ledger_entries"."half_days" < 0) or "leave_ledger_entries"."entry_type" in ('reversal', 'adjustment')),
	CONSTRAINT "leave_ledger_source_check" CHECK ("leave_ledger_entries"."source_type" in ('', 'leave_request', 'accrual_job', 'manual')),
	CONSTRAINT "leave_ledger_source_pair_check" CHECK (("leave_ledger_entries"."source_type" = 'leave_request') = ("leave_ledger_entries"."source_id" is not null)),
	CONSTRAINT "leave_ledger_reason_check" CHECK (length("leave_ledger_entries"."reason") <= 500),
	CONSTRAINT "leave_ledger_manual_check" CHECK ("leave_ledger_entries"."entry_type" not in ('reversal', 'adjustment') or ("leave_ledger_entries"."actor_user_id" is not null and length(trim("leave_ledger_entries"."reason")) > 0))
);
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "quota_exception_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "accrual_method" text DEFAULT 'annual' NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "carry_forward_cap" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "carry_forward_expiry_months" integer;--> statement-breakpoint
ALTER TABLE "leave_types" ADD COLUMN "encashable_on_exit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "leave_ledger_entries" ADD CONSTRAINT "leave_ledger_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger_entries" ADD CONSTRAINT "leave_ledger_employee_membership_fk" FOREIGN KEY ("tenant_id","employee_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger_entries" ADD CONSTRAINT "leave_ledger_actor_membership_fk" FOREIGN KEY ("tenant_id","actor_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "leave_ledger_entries_tenant_dedupe_unique" ON "leave_ledger_entries" USING btree ("tenant_id","dedupe_key") WHERE "leave_ledger_entries"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "leave_ledger_balance_idx" ON "leave_ledger_entries" USING btree ("tenant_id","employee_user_id","leave_type_code","leave_year");--> statement-breakpoint
CREATE INDEX "leave_ledger_year_type_idx" ON "leave_ledger_entries" USING btree ("tenant_id","leave_year","entry_type");--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_quota_exception_check" CHECK (length("leave_requests"."quota_exception_reason") <= 500 and ("leave_requests"."quota_exception_reason" = '' or "leave_requests"."status" = 'approved'));--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_accrual_method_check" CHECK ("leave_types"."accrual_method" in ('annual', 'monthly', 'none'));--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_carry_forward_cap_check" CHECK ("leave_types"."carry_forward_cap" between 0 and 365);--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_carry_forward_expiry_check" CHECK ("leave_types"."carry_forward_expiry_months" is null or "leave_types"."carry_forward_expiry_months" between 1 and 12);--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_carry_forward_pair_check" CHECK ("leave_types"."carry_forward_cap" > 0 or "leave_types"."carry_forward_expiry_months" is null);