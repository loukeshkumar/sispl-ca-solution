CREATE TABLE "holiday_calendar" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"holiday_date" date NOT NULL,
	"name" text NOT NULL,
	"holiday_type" text DEFAULT 'public' NOT NULL,
	"jurisdiction_state" text DEFAULT 'Bihar' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holiday_calendar_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "holiday_calendar_name_check" CHECK (length(trim("holiday_calendar"."name")) between 2 and 80),
	CONSTRAINT "holiday_calendar_type_check" CHECK ("holiday_calendar"."holiday_type" in ('public', 'restricted', 'optional')),
	CONSTRAINT "holiday_calendar_state_check" CHECK (length(trim("holiday_calendar"."jurisdiction_state")) between 2 and 40),
	CONSTRAINT "holiday_calendar_status_check" CHECK ("holiday_calendar"."status" in ('active', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"paid_by_default" boolean DEFAULT true NOT NULL,
	"allows_half_day" boolean DEFAULT true NOT NULL,
	"requires_reason" boolean DEFAULT true NOT NULL,
	"annual_quota_days" integer DEFAULT 0 NOT NULL,
	"display_order" integer DEFAULT 10 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_types_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "leave_types_code_check" CHECK ("leave_types"."code" ~ '^[a-z][a-z0-9_]{1,29}$'),
	CONSTRAINT "leave_types_name_check" CHECK (length(trim("leave_types"."name")) between 2 and 60),
	CONSTRAINT "leave_types_quota_check" CHECK ("leave_types"."annual_quota_days" between 0 and 365),
	CONSTRAINT "leave_types_order_check" CHECK ("leave_types"."display_order" between 0 and 999),
	CONSTRAINT "leave_types_status_check" CHECK ("leave_types"."status" in ('active', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "shift_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"start_time" text DEFAULT '09:30' NOT NULL,
	"end_time" text DEFAULT '18:00' NOT NULL,
	"full_day_minutes" integer DEFAULT 450 NOT NULL,
	"half_day_minutes" integer DEFAULT 225 NOT NULL,
	"late_grace_minutes" integer DEFAULT 15 NOT NULL,
	"working_week_mask" text DEFAULT '1111110' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_types_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "shift_types_code_check" CHECK ("shift_types"."code" ~ '^[A-Z0-9][A-Z0-9_-]{1,19}$'),
	CONSTRAINT "shift_types_name_check" CHECK (length(trim("shift_types"."name")) between 2 and 60),
	CONSTRAINT "shift_types_time_check" CHECK ("shift_types"."start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and "shift_types"."end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and "shift_types"."start_time" < "shift_types"."end_time"),
	CONSTRAINT "shift_types_week_mask_check" CHECK ("shift_types"."working_week_mask" ~ '^[01]{7}$' and "shift_types"."working_week_mask" like '%1%'),
	CONSTRAINT "shift_types_minutes_check" CHECK ("shift_types"."late_grace_minutes" between 0 and 180 and "shift_types"."full_day_minutes" between 60 and 960 and "shift_types"."half_day_minutes" between 30 and "shift_types"."full_day_minutes" - 1),
	CONSTRAINT "shift_types_status_check" CHECK ("shift_types"."status" in ('active', 'archived'))
);
--> statement-breakpoint
ALTER TABLE "leave_requests" DROP CONSTRAINT "leave_requests_type_check";--> statement-breakpoint
ALTER TABLE "employee_work_profiles" ADD COLUMN "shift_type_id" uuid;--> statement-breakpoint
ALTER TABLE "holiday_calendar" ADD CONSTRAINT "holiday_calendar_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_calendar" ADD CONSTRAINT "holiday_calendar_creator_membership_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_types" ADD CONSTRAINT "shift_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "holiday_calendar_tenant_date_state_unique" ON "holiday_calendar" USING btree ("tenant_id","holiday_date",lower("jurisdiction_state"));--> statement-breakpoint
CREATE INDEX "holiday_calendar_tenant_date_idx" ON "holiday_calendar" USING btree ("tenant_id","status","holiday_date");--> statement-breakpoint
CREATE UNIQUE INDEX "leave_types_tenant_code_lower_unique" ON "leave_types" USING btree ("tenant_id",lower("code"));--> statement-breakpoint
CREATE INDEX "leave_types_tenant_status_idx" ON "leave_types" USING btree ("tenant_id","status","display_order");--> statement-breakpoint
CREATE UNIQUE INDEX "shift_types_tenant_code_lower_unique" ON "shift_types" USING btree ("tenant_id",lower("code"));--> statement-breakpoint
CREATE UNIQUE INDEX "shift_types_tenant_default_unique" ON "shift_types" USING btree ("tenant_id") WHERE "shift_types"."is_default" and "shift_types"."status" = 'active';--> statement-breakpoint
CREATE INDEX "shift_types_tenant_status_idx" ON "shift_types" USING btree ("tenant_id","status","name");--> statement-breakpoint
ALTER TABLE "employee_work_profiles" ADD CONSTRAINT "employee_work_profiles_shift_tenant_fk" FOREIGN KEY ("tenant_id","shift_type_id") REFERENCES "public"."shift_types"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_type_check" CHECK ("leave_requests"."leave_type" ~ '^[a-z][a-z0-9_]{1,29}$');