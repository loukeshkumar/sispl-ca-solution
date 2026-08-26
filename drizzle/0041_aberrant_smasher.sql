CREATE TABLE "procedure_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"procedure_version_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"instruction" text DEFAULT '' NOT NULL,
	"mandatory" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "procedure_steps_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "procedure_steps_version_position_unique" UNIQUE("tenant_id","procedure_version_id","position"),
	CONSTRAINT "procedure_steps_position_check" CHECK ("procedure_steps"."position" between 1 and 200),
	CONSTRAINT "procedure_steps_title_check" CHECK (length(trim("procedure_steps"."title")) between 2 and 200),
	CONSTRAINT "procedure_steps_instruction_check" CHECK (length("procedure_steps"."instruction") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "procedure_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"service_code" text NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"effective_from" date NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"published_by_user_id" uuid,
	"published_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "procedure_versions_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "procedure_versions_service_version_unique" UNIQUE("tenant_id","service_code","version"),
	CONSTRAINT "procedure_versions_service_check" CHECK ("procedure_versions"."service_code" ~ '^[A-Z0-9][A-Z0-9_-]{1,19}$'),
	CONSTRAINT "procedure_versions_status_check" CHECK ("procedure_versions"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "procedure_versions_version_check" CHECK ("procedure_versions"."version" > 0),
	CONSTRAINT "procedure_versions_published_state_check" CHECK ("procedure_versions"."status" = 'draft' or ("procedure_versions"."published_at" is not null and "procedure_versions"."published_by_user_id" is not null)),
	CONSTRAINT "procedure_versions_note_check" CHECK (length("procedure_versions"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "work_item_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"procedure_version_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"instruction" text DEFAULT '' NOT NULL,
	"mandatory" boolean DEFAULT true NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"completed_by_user_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_steps_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "work_item_steps_item_position_unique" UNIQUE("tenant_id","work_item_id","position"),
	CONSTRAINT "work_item_steps_position_check" CHECK ("work_item_steps"."position" between 1 and 200),
	CONSTRAINT "work_item_steps_status_check" CHECK ("work_item_steps"."status" in ('pending', 'done', 'not_applicable')),
	CONSTRAINT "work_item_steps_title_check" CHECK (length(trim("work_item_steps"."title")) between 2 and 200),
	CONSTRAINT "work_item_steps_text_check" CHECK (length("work_item_steps"."instruction") <= 1000 and length("work_item_steps"."note") <= 1000),
	CONSTRAINT "work_item_steps_done_state_check" CHECK (("work_item_steps"."status" = 'pending' and "work_item_steps"."completed_by_user_id" is null and "work_item_steps"."completed_at" is null) or ("work_item_steps"."status" <> 'pending' and "work_item_steps"."completed_by_user_id" is not null and "work_item_steps"."completed_at" is not null)),
	CONSTRAINT "work_item_steps_not_applicable_check" CHECK ("work_item_steps"."status" <> 'not_applicable' or length(trim("work_item_steps"."note")) > 0)
);
--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "procedure_version_id" uuid;--> statement-breakpoint
ALTER TABLE "procedure_steps" ADD CONSTRAINT "procedure_steps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_steps" ADD CONSTRAINT "procedure_steps_version_tenant_fk" FOREIGN KEY ("tenant_id","procedure_version_id") REFERENCES "public"."procedure_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_versions" ADD CONSTRAINT "procedure_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_versions" ADD CONSTRAINT "procedure_versions_creator_membership_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_versions" ADD CONSTRAINT "procedure_versions_publisher_membership_fk" FOREIGN KEY ("tenant_id","published_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_steps" ADD CONSTRAINT "work_item_steps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_steps" ADD CONSTRAINT "work_item_steps_item_tenant_fk" FOREIGN KEY ("tenant_id","work_item_id") REFERENCES "public"."work_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_item_steps" ADD CONSTRAINT "work_item_steps_completer_membership_fk" FOREIGN KEY ("tenant_id","completed_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "procedure_steps_version_idx" ON "procedure_steps" USING btree ("tenant_id","procedure_version_id","position");--> statement-breakpoint
CREATE INDEX "procedure_versions_lookup_idx" ON "procedure_versions" USING btree ("tenant_id","service_code","status","effective_from");--> statement-breakpoint
CREATE INDEX "work_item_steps_item_idx" ON "work_item_steps" USING btree ("tenant_id","work_item_id","position");