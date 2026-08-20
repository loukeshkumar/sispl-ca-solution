CREATE TABLE "personal_todos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"due_date" date,
	"due_time" text,
	"priority" text DEFAULT 'normal' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"completed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "personal_todos_title_check" CHECK (length(trim("personal_todos"."title")) between 1 and 160),
	CONSTRAINT "personal_todos_notes_check" CHECK (length("personal_todos"."notes") <= 2000),
	CONSTRAINT "personal_todos_category_check" CHECK (length("personal_todos"."category") <= 40),
	CONSTRAINT "personal_todos_due_time_check" CHECK ("personal_todos"."due_time" is null or "personal_todos"."due_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "personal_todos_priority_check" CHECK ("personal_todos"."priority" in ('low', 'normal', 'high', 'urgent')),
	CONSTRAINT "personal_todos_status_check" CHECK ("personal_todos"."status" in ('open', 'completed', 'archived')),
	CONSTRAINT "personal_todos_completed_state_check" CHECK (("personal_todos"."status" = 'completed' and "personal_todos"."completed_at" is not null) or ("personal_todos"."status" <> 'completed' and "personal_todos"."completed_at" is null)),
	CONSTRAINT "personal_todos_archived_state_check" CHECK (("personal_todos"."status" = 'archived' and "personal_todos"."archived_at" is not null) or ("personal_todos"."status" <> 'archived' and "personal_todos"."archived_at" is null))
);
--> statement-breakpoint
ALTER TABLE "personal_todos" ADD CONSTRAINT "personal_todos_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personal_todos" ADD CONSTRAINT "personal_todos_owner_membership_fk" FOREIGN KEY ("tenant_id","owner_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "personal_todos_owner_status_due_idx" ON "personal_todos" USING btree ("tenant_id","owner_user_id","status","due_date");--> statement-breakpoint
CREATE INDEX "personal_todos_owner_updated_idx" ON "personal_todos" USING btree ("tenant_id","owner_user_id","updated_at");