CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"notification_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text DEFAULT '' NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_deliveries_notification_channel_unique" UNIQUE("tenant_id","notification_id","channel"),
	CONSTRAINT "notification_deliveries_channel_check" CHECK ("notification_deliveries"."channel" in ('email', 'whatsapp')),
	CONSTRAINT "notification_deliveries_status_check" CHECK ("notification_deliveries"."status" in ('pending', 'sent', 'failed')),
	CONSTRAINT "notification_deliveries_attempts_check" CHECK ("notification_deliveries"."attempt_count" >= 0),
	CONSTRAINT "notification_deliveries_sent_state_check" CHECK (("notification_deliveries"."status" = 'sent' and "notification_deliveries"."sent_at" is not null) or ("notification_deliveries"."status" <> 'sent' and "notification_deliveries"."sent_at" is null))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"resource_type" text DEFAULT '' NOT NULL,
	"resource_id" uuid,
	"dedupe_key" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('work_item_due', 'work_item_overdue', 'document_request_overdue', 'task_assigned', 'attendance_request_decided', 'payslip_published')),
	CONSTRAINT "notifications_title_check" CHECK (length(trim("notifications"."title")) between 1 and 200),
	CONSTRAINT "notifications_body_check" CHECK (length("notifications"."body") <= 2000),
	CONSTRAINT "notifications_resource_type_check" CHECK ("notifications"."resource_type" in ('', 'work_item', 'document_request', 'office_task', 'leave_request', 'attendance_correction_request', 'payroll_entry')),
	CONSTRAINT "notifications_resource_pair_check" CHECK (("notifications"."resource_type" = '' and "notifications"."resource_id" is null) or ("notifications"."resource_type" <> '' and "notifications"."resource_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_fk" FOREIGN KEY ("tenant_id","notification_id") REFERENCES "public"."notifications"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_membership_fk" FOREIGN KEY ("tenant_id","recipient_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_deliveries_status_idx" ON "notification_deliveries" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_tenant_dedupe_unique" ON "notifications" USING btree ("tenant_id","dedupe_key") WHERE "notifications"."dedupe_key" is not null;--> statement-breakpoint
CREATE INDEX "notifications_recipient_unread_idx" ON "notifications" USING btree ("tenant_id","recipient_user_id","read_at","created_at");