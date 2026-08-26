ALTER TABLE "employee_profiles" ADD COLUMN "employment_stage" text DEFAULT 'confirmed' NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "probation_end_date" date;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "confirmed_on" date;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "notice_start_date" date;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "exit_reason" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD COLUMN "exit_clearance_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_stage_check" CHECK ("employee_profiles"."employment_stage" in ('probation', 'confirmed', 'notice', 'exited'));--> statement-breakpoint
--> Everyone already on the books predates this column and defaults to
--> `confirmed`. Their confirmation date is unrecorded, so the honest reading is
--> that they have been confirmed since they joined; without this the constraint
--> below rejects every existing row.
UPDATE "employee_profiles" SET "confirmed_on" = "joining_date" WHERE "employment_stage" = 'confirmed' AND "confirmed_on" IS NULL;--> statement-breakpoint
UPDATE "employee_profiles" SET "employment_stage" = 'exited' WHERE "employment_end_date" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_confirmed_state_check" CHECK ("employee_profiles"."employment_stage" <> 'confirmed' or "employee_profiles"."confirmed_on" is not null);--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_notice_state_check" CHECK ("employee_profiles"."employment_stage" <> 'notice' or "employee_profiles"."notice_start_date" is not null);--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_exited_state_check" CHECK ("employee_profiles"."employment_stage" <> 'exited' or "employee_profiles"."employment_end_date" is not null);--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_probation_end_check" CHECK ("employee_profiles"."probation_end_date" is null or "employee_profiles"."probation_end_date" >= "employee_profiles"."joining_date");--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_confirmed_on_check" CHECK ("employee_profiles"."confirmed_on" is null or "employee_profiles"."confirmed_on" >= "employee_profiles"."joining_date");--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_notice_start_check" CHECK ("employee_profiles"."notice_start_date" is null or "employee_profiles"."notice_start_date" >= "employee_profiles"."joining_date");--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_exit_text_check" CHECK (length("employee_profiles"."exit_reason") <= 300 and length("employee_profiles"."exit_clearance_note") <= 500);