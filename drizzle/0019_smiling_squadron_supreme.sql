CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"line_type" text NOT NULL,
	"description" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_lines_invoice_position_unique" UNIQUE("tenant_id","invoice_id","position"),
	CONSTRAINT "invoice_lines_type_check" CHECK ("invoice_lines"."line_type" in ('package_fee', 'addon', 'service', 'adjustment')),
	CONSTRAINT "invoice_lines_description_check" CHECK (length(trim("invoice_lines"."description")) between 1 and 200),
	CONSTRAINT "invoice_lines_amount_check" CHECK ("invoice_lines"."amount_paise" >= 0),
	CONSTRAINT "invoice_lines_position_check" CHECK ("invoice_lines"."position" between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"assignment_id" uuid,
	"invoice_seq" integer NOT NULL,
	"invoice_number" text NOT NULL,
	"period_label" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"subtotal_paise" bigint NOT NULL,
	"tax_paise" bigint DEFAULT 0 NOT NULL,
	"total_paise" bigint NOT NULL,
	"issue_date" date,
	"due_date" date,
	"payment_reference" text DEFAULT '' NOT NULL,
	"cancellation_reason" text DEFAULT '' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"issued_by_user_id" uuid,
	"payment_recorded_by_user_id" uuid,
	"issued_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "invoices_tenant_seq_unique" UNIQUE("tenant_id","invoice_seq"),
	CONSTRAINT "invoices_seq_check" CHECK ("invoices"."invoice_seq" > 0),
	CONSTRAINT "invoices_number_check" CHECK (length(trim("invoices"."invoice_number")) between 3 and 40),
	CONSTRAINT "invoices_period_check" CHECK (length(trim("invoices"."period_label")) between 2 and 60),
	CONSTRAINT "invoices_notes_check" CHECK (length("invoices"."notes") <= 2000),
	CONSTRAINT "invoices_status_check" CHECK ("invoices"."status" in ('draft', 'issued', 'paid', 'cancelled')),
	CONSTRAINT "invoices_amounts_check" CHECK ("invoices"."subtotal_paise" >= 0 and "invoices"."tax_paise" >= 0 and "invoices"."total_paise" = "invoices"."subtotal_paise" + "invoices"."tax_paise"),
	CONSTRAINT "invoices_issued_state_check" CHECK (("invoices"."status" in ('issued', 'paid') and "invoices"."issued_at" is not null and "invoices"."issued_by_user_id" is not null and "invoices"."issue_date" is not null and "invoices"."due_date" is not null) or ("invoices"."status" in ('draft', 'cancelled') and ("invoices"."status" = 'cancelled' or "invoices"."issued_at" is null))),
	CONSTRAINT "invoices_due_after_issue_check" CHECK ("invoices"."issue_date" is null or "invoices"."due_date" is null or "invoices"."due_date" >= "invoices"."issue_date"),
	CONSTRAINT "invoices_paid_state_check" CHECK (("invoices"."status" = 'paid' and "invoices"."paid_at" is not null and "invoices"."payment_recorded_by_user_id" is not null) or ("invoices"."status" <> 'paid' and "invoices"."paid_at" is null and "invoices"."payment_recorded_by_user_id" is null)),
	CONSTRAINT "invoices_cancelled_state_check" CHECK (("invoices"."status" = 'cancelled' and "invoices"."cancelled_at" is not null and length(trim("invoices"."cancellation_reason")) > 0) or ("invoices"."status" <> 'cancelled' and "invoices"."cancelled_at" is null and "invoices"."cancellation_reason" = ''))
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_check";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_resource_type_check";--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_tenant_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_entity_tenant_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "public"."legal_entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_assignment_tenant_fk" FOREIGN KEY ("tenant_id","assignment_id") REFERENCES "public"."client_package_assignments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_creator_membership_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issuer_membership_fk" FOREIGN KEY ("tenant_id","issued_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_recorder_membership_fk" FOREIGN KEY ("tenant_id","payment_recorded_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_idx" ON "invoice_lines" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_tenant_number_lower_unique" ON "invoices" USING btree ("tenant_id",lower("invoice_number"));--> statement-breakpoint
CREATE INDEX "invoices_tenant_status_due_idx" ON "invoices" USING btree ("tenant_id","status","due_date");--> statement-breakpoint
CREATE INDEX "invoices_tenant_entity_idx" ON "invoices" USING btree ("tenant_id","legal_entity_id","created_at");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('work_item_due', 'work_item_overdue', 'document_request_overdue', 'task_assigned', 'attendance_request_decided', 'payslip_published', 'invoice_overdue'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_resource_type_check" CHECK ("notifications"."resource_type" in ('', 'work_item', 'document_request', 'office_task', 'leave_request', 'attendance_correction_request', 'payroll_entry', 'invoice'));