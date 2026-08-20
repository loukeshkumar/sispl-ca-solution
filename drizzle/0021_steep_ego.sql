CREATE TABLE "dsc_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"holder_name" text NOT NULL,
	"serial_number" text NOT NULL,
	"issuing_authority" text NOT NULL,
	"certificate_class" text DEFAULT 'class_3' NOT NULL,
	"valid_from" date NOT NULL,
	"valid_until" date NOT NULL,
	"status" text DEFAULT 'in_custody' NOT NULL,
	"custodian_user_id" uuid,
	"storage_location" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"recorded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dsc_certificates_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "dsc_certificates_holder_check" CHECK (length(trim("dsc_certificates"."holder_name")) between 2 and 120),
	CONSTRAINT "dsc_certificates_serial_check" CHECK ("dsc_certificates"."serial_number" ~ '^[A-Za-z0-9:_-]{4,64}$'),
	CONSTRAINT "dsc_certificates_authority_check" CHECK (length(trim("dsc_certificates"."issuing_authority")) between 2 and 120),
	CONSTRAINT "dsc_certificates_class_check" CHECK ("dsc_certificates"."certificate_class" in ('class_2', 'class_3', 'dgft')),
	CONSTRAINT "dsc_certificates_validity_check" CHECK ("dsc_certificates"."valid_until" >= "dsc_certificates"."valid_from"),
	CONSTRAINT "dsc_certificates_status_check" CHECK ("dsc_certificates"."status" in ('in_custody', 'issued_out', 'returned', 'expired', 'surrendered')),
	CONSTRAINT "dsc_certificates_custody_check" CHECK ("dsc_certificates"."status" <> 'in_custody' or "dsc_certificates"."custodian_user_id" is not null),
	CONSTRAINT "dsc_certificates_location_check" CHECK (length("dsc_certificates"."storage_location") <= 160),
	CONSTRAINT "dsc_certificates_notes_check" CHECK (length("dsc_certificates"."notes") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "dsc_custody_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"dsc_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"custodian_user_id" uuid,
	"counterparty_name" text DEFAULT '' NOT NULL,
	"remarks" text DEFAULT '' NOT NULL,
	"recorded_by_user_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dsc_custody_events_type_check" CHECK ("dsc_custody_events"."event_type" in ('received', 'issued_out', 'returned', 'surrendered', 'expired')),
	CONSTRAINT "dsc_custody_events_counterparty_check" CHECK (length("dsc_custody_events"."counterparty_name") <= 120),
	CONSTRAINT "dsc_custody_events_remarks_check" CHECK (length("dsc_custody_events"."remarks") <= 500)
);
--> statement-breakpoint
CREATE TABLE "statutory_notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"work_item_id" uuid,
	"authority" text NOT NULL,
	"notice_number" text NOT NULL,
	"notice_section" text DEFAULT '' NOT NULL,
	"subject" text NOT NULL,
	"notice_date" date NOT NULL,
	"received_date" date NOT NULL,
	"response_due_date" date NOT NULL,
	"assignee_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"responded_on" date,
	"response_summary" text DEFAULT '' NOT NULL,
	"recorded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "statutory_notices_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "statutory_notices_tenant_entity_number_unique" UNIQUE("tenant_id","legal_entity_id","notice_number"),
	CONSTRAINT "statutory_notices_authority_check" CHECK ("statutory_notices"."authority" in ('income_tax', 'gst', 'tds', 'roc', 'other')),
	CONSTRAINT "statutory_notices_number_check" CHECK (length(trim("statutory_notices"."notice_number")) between 2 and 80),
	CONSTRAINT "statutory_notices_section_check" CHECK (length("statutory_notices"."notice_section") <= 60),
	CONSTRAINT "statutory_notices_subject_check" CHECK (length(trim("statutory_notices"."subject")) between 2 and 200),
	CONSTRAINT "statutory_notices_summary_check" CHECK (length("statutory_notices"."response_summary") <= 2000),
	CONSTRAINT "statutory_notices_status_check" CHECK ("statutory_notices"."status" in ('open', 'in_progress', 'responded', 'closed')),
	CONSTRAINT "statutory_notices_date_order_check" CHECK ("statutory_notices"."received_date" >= "statutory_notices"."notice_date" and "statutory_notices"."response_due_date" >= "statutory_notices"."received_date"),
	CONSTRAINT "statutory_notices_responded_state_check" CHECK (("statutory_notices"."status" in ('responded', 'closed') and "statutory_notices"."responded_on" is not null) or ("statutory_notices"."status" in ('open', 'in_progress') and "statutory_notices"."responded_on" is null))
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_user_id" uuid NOT NULL,
	"entry_date" date NOT NULL,
	"minutes" integer NOT NULL,
	"legal_entity_id" uuid,
	"work_item_id" uuid,
	"office_task_id" uuid,
	"billable" boolean DEFAULT true NOT NULL,
	"narration" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_entries_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "time_entries_minutes_check" CHECK ("time_entries"."minutes" between 1 and 1440),
	CONSTRAINT "time_entries_narration_check" CHECK (length(trim("time_entries"."narration")) between 2 and 500),
	CONSTRAINT "time_entries_billable_scope_check" CHECK ("time_entries"."billable" = false or "time_entries"."legal_entity_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "udin_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"work_item_id" uuid,
	"udin" text NOT NULL,
	"document_type" text NOT NULL,
	"document_description" text NOT NULL,
	"membership_number" text NOT NULL,
	"signed_by_user_id" uuid NOT NULL,
	"generated_on" date NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"revocation_reason" text DEFAULT '' NOT NULL,
	"revoked_at" timestamp with time zone,
	"recorded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "udin_registrations_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "udin_registrations_udin_check" CHECK ("udin_registrations"."udin" ~ '^[0-9]{8}[A-Za-z0-9]{10}$'),
	CONSTRAINT "udin_registrations_type_check" CHECK ("udin_registrations"."document_type" in ('tax_audit', 'statutory_audit', 'gst_audit', 'certificate', 'itr_filing', 'roc_filing', 'other')),
	CONSTRAINT "udin_registrations_description_check" CHECK (length(trim("udin_registrations"."document_description")) between 2 and 200),
	CONSTRAINT "udin_registrations_membership_check" CHECK ("udin_registrations"."membership_number" ~ '^[0-9]{6}$'),
	CONSTRAINT "udin_registrations_status_check" CHECK ("udin_registrations"."status" in ('active', 'revoked')),
	CONSTRAINT "udin_registrations_revoked_state_check" CHECK (("udin_registrations"."status" = 'revoked' and "udin_registrations"."revoked_at" is not null and length(trim("udin_registrations"."revocation_reason")) > 0) or ("udin_registrations"."status" <> 'revoked' and "udin_registrations"."revoked_at" is null and "udin_registrations"."revocation_reason" = ''))
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_check";--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_resource_type_check";--> statement-breakpoint
ALTER TABLE "dsc_certificates" ADD CONSTRAINT "dsc_certificates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dsc_certificates" ADD CONSTRAINT "dsc_certificates_entity_tenant_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "public"."legal_entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dsc_certificates" ADD CONSTRAINT "dsc_certificates_custodian_membership_fk" FOREIGN KEY ("tenant_id","custodian_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dsc_certificates" ADD CONSTRAINT "dsc_certificates_recorder_membership_fk" FOREIGN KEY ("tenant_id","recorded_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dsc_custody_events" ADD CONSTRAINT "dsc_custody_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dsc_custody_events" ADD CONSTRAINT "dsc_custody_events_dsc_tenant_fk" FOREIGN KEY ("tenant_id","dsc_id") REFERENCES "public"."dsc_certificates"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dsc_custody_events" ADD CONSTRAINT "dsc_custody_events_custodian_membership_fk" FOREIGN KEY ("tenant_id","custodian_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dsc_custody_events" ADD CONSTRAINT "dsc_custody_events_recorder_membership_fk" FOREIGN KEY ("tenant_id","recorded_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statutory_notices" ADD CONSTRAINT "statutory_notices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statutory_notices" ADD CONSTRAINT "statutory_notices_entity_tenant_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "public"."legal_entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statutory_notices" ADD CONSTRAINT "statutory_notices_work_tenant_fk" FOREIGN KEY ("tenant_id","work_item_id") REFERENCES "public"."work_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statutory_notices" ADD CONSTRAINT "statutory_notices_assignee_membership_fk" FOREIGN KEY ("tenant_id","assignee_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statutory_notices" ADD CONSTRAINT "statutory_notices_recorder_membership_fk" FOREIGN KEY ("tenant_id","recorded_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_employee_membership_fk" FOREIGN KEY ("tenant_id","employee_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_entity_tenant_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "public"."legal_entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_work_tenant_fk" FOREIGN KEY ("tenant_id","work_item_id") REFERENCES "public"."work_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_task_tenant_fk" FOREIGN KEY ("tenant_id","office_task_id") REFERENCES "public"."office_tasks"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "udin_registrations" ADD CONSTRAINT "udin_registrations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "udin_registrations" ADD CONSTRAINT "udin_registrations_entity_tenant_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "public"."legal_entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "udin_registrations" ADD CONSTRAINT "udin_registrations_work_tenant_fk" FOREIGN KEY ("tenant_id","work_item_id") REFERENCES "public"."work_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "udin_registrations" ADD CONSTRAINT "udin_registrations_signer_membership_fk" FOREIGN KEY ("tenant_id","signed_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "udin_registrations" ADD CONSTRAINT "udin_registrations_recorder_membership_fk" FOREIGN KEY ("tenant_id","recorded_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dsc_certificates_tenant_serial_unique" ON "dsc_certificates" USING btree ("tenant_id",upper("serial_number"));--> statement-breakpoint
CREATE INDEX "dsc_certificates_tenant_expiry_idx" ON "dsc_certificates" USING btree ("tenant_id","status","valid_until");--> statement-breakpoint
CREATE INDEX "dsc_custody_events_dsc_idx" ON "dsc_custody_events" USING btree ("tenant_id","dsc_id","occurred_at");--> statement-breakpoint
CREATE INDEX "statutory_notices_tenant_status_due_idx" ON "statutory_notices" USING btree ("tenant_id","status","response_due_date");--> statement-breakpoint
CREATE INDEX "time_entries_employee_date_idx" ON "time_entries" USING btree ("tenant_id","employee_user_id","entry_date");--> statement-breakpoint
CREATE INDEX "time_entries_entity_date_idx" ON "time_entries" USING btree ("tenant_id","legal_entity_id","entry_date");--> statement-breakpoint
CREATE UNIQUE INDEX "udin_registrations_tenant_udin_unique" ON "udin_registrations" USING btree ("tenant_id",upper("udin"));--> statement-breakpoint
CREATE INDEX "udin_registrations_tenant_generated_idx" ON "udin_registrations" USING btree ("tenant_id","generated_on");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('work_item_due', 'work_item_overdue', 'document_request_overdue', 'task_assigned', 'attendance_request_decided', 'payslip_published', 'invoice_overdue', 'dsc_expiring', 'notice_due'));--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_resource_type_check" CHECK ("notifications"."resource_type" in ('', 'work_item', 'document_request', 'office_task', 'leave_request', 'attendance_correction_request', 'payroll_entry', 'invoice', 'dsc_certificate', 'statutory_notice'));