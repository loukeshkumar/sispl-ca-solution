CREATE TABLE "employee_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"employee_code" text NOT NULL,
	"designation" text NOT NULL,
	"mobile_number" text DEFAULT '' NOT NULL,
	"joining_date" date NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_profiles_tenant_user_unique" UNIQUE("tenant_id","user_id"),
	CONSTRAINT "employee_profiles_tenant_code_unique" UNIQUE("tenant_id","employee_code")
);
--> statement-breakpoint
CREATE TABLE "office_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"assignee_id" uuid NOT NULL,
	"reviewer_id" uuid,
	"assigned_by_user_id" uuid NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'todo' NOT NULL,
	"due_date" date NOT NULL,
	"blocker_note" text DEFAULT '' NOT NULL,
	"legal_entity_id" uuid,
	"work_item_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "office_tasks_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "office_tasks_priority_check" CHECK ("office_tasks"."priority" in ('low', 'normal', 'high', 'urgent')),
	CONSTRAINT "office_tasks_status_check" CHECK ("office_tasks"."status" in ('todo', 'in_progress', 'waiting', 'review', 'completed', 'cancelled')),
	CONSTRAINT "office_tasks_reviewer_separation_check" CHECK ("office_tasks"."reviewer_id" is null or "office_tasks"."reviewer_id" <> "office_tasks"."assignee_id"),
	CONSTRAINT "office_tasks_waiting_note_check" CHECK ("office_tasks"."status" <> 'waiting' or length(trim("office_tasks"."blocker_note")) > 0),
	CONSTRAINT "office_tasks_work_client_check" CHECK ("office_tasks"."work_item_id" is null or "office_tasks"."legal_entity_id" is not null),
	CONSTRAINT "office_tasks_completed_state_check" CHECK (("office_tasks"."status" = 'completed' and "office_tasks"."completed_at" is not null) or ("office_tasks"."status" <> 'completed' and "office_tasks"."completed_at" is null))
);
--> statement-breakpoint
ALTER TABLE "user_credentials" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_membership_fk" FOREIGN KEY ("tenant_id","user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_tenant_id_entity_unique" UNIQUE("tenant_id","id","legal_entity_id");--> statement-breakpoint
ALTER TABLE "office_tasks" ADD CONSTRAINT "office_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_tasks" ADD CONSTRAINT "office_tasks_assignee_membership_fk" FOREIGN KEY ("tenant_id","assignee_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_tasks" ADD CONSTRAINT "office_tasks_reviewer_membership_fk" FOREIGN KEY ("tenant_id","reviewer_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_tasks" ADD CONSTRAINT "office_tasks_assigner_membership_fk" FOREIGN KEY ("tenant_id","assigned_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_tasks" ADD CONSTRAINT "office_tasks_entity_tenant_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "public"."legal_entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "office_tasks" ADD CONSTRAINT "office_tasks_work_entity_tenant_fk" FOREIGN KEY ("tenant_id","work_item_id","legal_entity_id") REFERENCES "public"."work_items"("tenant_id","id","legal_entity_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_profiles_tenant_idx" ON "employee_profiles" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "office_tasks_assignee_status_due_idx" ON "office_tasks" USING btree ("tenant_id","assignee_id","status","due_date");--> statement-breakpoint
CREATE INDEX "office_tasks_status_due_idx" ON "office_tasks" USING btree ("tenant_id","status","due_date");
