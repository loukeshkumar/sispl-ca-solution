CREATE TABLE "work_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"document_request_id" uuid,
	"depends_on_work_item_id" uuid,
	"external_party" text,
	"expected_on" date NOT NULL,
	"raised_by_user_id" uuid NOT NULL,
	"cleared_at" timestamp with time zone,
	"cleared_by_user_id" uuid,
	"clearance_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_dependencies_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "work_dependencies_kind_check" CHECK ("work_dependencies"."kind" in ('client_request', 'work_item', 'external')),
	CONSTRAINT "work_dependencies_target_check" CHECK (
    ("work_dependencies"."kind" = 'client_request' and "work_dependencies"."document_request_id" is not null and "work_dependencies"."depends_on_work_item_id" is null and "work_dependencies"."external_party" is null)
    or ("work_dependencies"."kind" = 'work_item' and "work_dependencies"."depends_on_work_item_id" is not null and "work_dependencies"."document_request_id" is null and "work_dependencies"."external_party" is null)
    or ("work_dependencies"."kind" = 'external' and "work_dependencies"."external_party" is not null and "work_dependencies"."document_request_id" is null and "work_dependencies"."depends_on_work_item_id" is null)
  ),
	CONSTRAINT "work_dependencies_self_check" CHECK ("work_dependencies"."depends_on_work_item_id" is null or "work_dependencies"."depends_on_work_item_id" <> "work_dependencies"."work_item_id"),
	CONSTRAINT "work_dependencies_cleared_pair_check" CHECK (("work_dependencies"."cleared_at" is null and "work_dependencies"."cleared_by_user_id" is null) or ("work_dependencies"."cleared_at" is not null and "work_dependencies"."cleared_by_user_id" is not null)),
	CONSTRAINT "work_dependencies_title_check" CHECK (length(trim("work_dependencies"."title")) between 3 and 200),
	CONSTRAINT "work_dependencies_party_check" CHECK ("work_dependencies"."external_party" is null or length(trim("work_dependencies"."external_party")) between 2 and 120),
	CONSTRAINT "work_dependencies_note_check" CHECK (length("work_dependencies"."clearance_note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_check";--> statement-breakpoint
ALTER TABLE "work_dependencies" ADD CONSTRAINT "work_dependencies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_dependencies" ADD CONSTRAINT "work_dependencies_work_tenant_fk" FOREIGN KEY ("tenant_id","work_item_id") REFERENCES "public"."work_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_dependencies" ADD CONSTRAINT "work_dependencies_request_tenant_fk" FOREIGN KEY ("tenant_id","document_request_id") REFERENCES "public"."document_requests"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_dependencies" ADD CONSTRAINT "work_dependencies_predecessor_tenant_fk" FOREIGN KEY ("tenant_id","depends_on_work_item_id") REFERENCES "public"."work_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_dependencies" ADD CONSTRAINT "work_dependencies_raiser_membership_fk" FOREIGN KEY ("tenant_id","raised_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_dependencies" ADD CONSTRAINT "work_dependencies_clearer_membership_fk" FOREIGN KEY ("tenant_id","cleared_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "work_dependencies_open_idx" ON "work_dependencies" USING btree ("tenant_id","work_item_id","cleared_at");--> statement-breakpoint
CREATE INDEX "work_dependencies_expected_idx" ON "work_dependencies" USING btree ("tenant_id","expected_on","cleared_at");--> statement-breakpoint
CREATE INDEX "work_dependencies_request_idx" ON "work_dependencies" USING btree ("tenant_id","document_request_id");--> statement-breakpoint
CREATE INDEX "work_dependencies_predecessor_idx" ON "work_dependencies" USING btree ("tenant_id","depends_on_work_item_id");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('work_item_due', 'work_item_overdue', 'document_request_overdue', 'task_assigned', 'attendance_request_raised', 'attendance_request_decided', 'payslip_published', 'invoice_overdue', 'dsc_expiring', 'notice_due', 'work_dependency_cleared', 'work_dependency_overdue'));