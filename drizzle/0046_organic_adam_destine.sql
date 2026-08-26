CREATE TABLE "escalation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"rung" integer NOT NULL,
	"anchor" text NOT NULL,
	"offset_days" integer NOT NULL,
	"target_kind" text NOT NULL,
	"target_role" text,
	"label" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "escalation_rules_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "escalation_rules_rung_check" CHECK ("escalation_rules"."rung" between 1 and 20),
	CONSTRAINT "escalation_rules_anchor_check" CHECK ("escalation_rules"."anchor" in ('internal_due', 'statutory_due')),
	CONSTRAINT "escalation_rules_offset_check" CHECK ("escalation_rules"."offset_days" between -60 and 60),
	CONSTRAINT "escalation_rules_target_kind_check" CHECK ("escalation_rules"."target_kind" in ('assignee', 'role')),
	CONSTRAINT "escalation_rules_target_pair_check" CHECK (
    ("escalation_rules"."target_kind" = 'role' and "escalation_rules"."target_role" is not null)
    or ("escalation_rules"."target_kind" = 'assignee' and "escalation_rules"."target_role" is null)
  ),
	CONSTRAINT "escalation_rules_role_value_check" CHECK ("escalation_rules"."target_role" is null or "escalation_rules"."target_role" in ('firm_administrator', 'partner', 'manager', 'associate')),
	CONSTRAINT "escalation_rules_label_check" CHECK (length(trim("escalation_rules"."label")) between 3 and 120),
	CONSTRAINT "escalation_rules_status_check" CHECK ("escalation_rules"."status" in ('active', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "work_escalations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"rung" integer NOT NULL,
	"rule_id" uuid,
	"reason" text NOT NULL,
	"fired_on" date NOT NULL,
	"notified_count" integer DEFAULT 0 NOT NULL,
	"recipient_summary" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_escalations_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "work_escalations_item_rung_unique" UNIQUE("tenant_id","work_item_id","rung"),
	CONSTRAINT "work_escalations_rung_check" CHECK ("work_escalations"."rung" between 1 and 20),
	CONSTRAINT "work_escalations_notified_check" CHECK ("work_escalations"."notified_count" >= 0),
	CONSTRAINT "work_escalations_reason_check" CHECK (length(trim("work_escalations"."reason")) between 3 and 120),
	CONSTRAINT "work_escalations_summary_check" CHECK (length("work_escalations"."recipient_summary") <= 500)
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_type_check";--> statement-breakpoint
ALTER TABLE "escalation_rules" ADD CONSTRAINT "escalation_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_rules" ADD CONSTRAINT "escalation_rules_creator_membership_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_escalations" ADD CONSTRAINT "work_escalations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_escalations" ADD CONSTRAINT "work_escalations_work_tenant_fk" FOREIGN KEY ("tenant_id","work_item_id") REFERENCES "public"."work_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_escalations" ADD CONSTRAINT "work_escalations_rule_tenant_fk" FOREIGN KEY ("tenant_id","rule_id") REFERENCES "public"."escalation_rules"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "escalation_rules_tenant_rung_unique" ON "escalation_rules" USING btree ("tenant_id","rung") WHERE "escalation_rules"."status" = 'active';--> statement-breakpoint
CREATE INDEX "escalation_rules_active_idx" ON "escalation_rules" USING btree ("tenant_id","status","rung");--> statement-breakpoint
CREATE INDEX "work_escalations_item_idx" ON "work_escalations" USING btree ("tenant_id","work_item_id","rung");--> statement-breakpoint
CREATE INDEX "work_escalations_fired_idx" ON "work_escalations" USING btree ("tenant_id","fired_on");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_type_check" CHECK ("notifications"."type" in ('work_item_due', 'work_item_overdue', 'document_request_overdue', 'task_assigned', 'attendance_request_raised', 'attendance_request_decided', 'payslip_published', 'invoice_overdue', 'dsc_expiring', 'notice_due', 'work_dependency_cleared', 'work_dependency_overdue', 'work_item_escalated'));