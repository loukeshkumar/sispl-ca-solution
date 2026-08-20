ALTER TABLE "office_tasks" ADD COLUMN "estimate_minutes" integer;--> statement-breakpoint
CREATE INDEX "office_tasks_reviewer_idx" ON "office_tasks" USING btree ("tenant_id","reviewer_id","status");--> statement-breakpoint
CREATE INDEX "office_tasks_assigner_idx" ON "office_tasks" USING btree ("tenant_id","assigned_by_user_id","status");--> statement-breakpoint
CREATE INDEX "time_entries_task_idx" ON "time_entries" USING btree ("tenant_id","office_task_id");--> statement-breakpoint
ALTER TABLE "office_tasks" ADD CONSTRAINT "office_tasks_estimate_minutes_check" CHECK ("office_tasks"."estimate_minutes" is null or "office_tasks"."estimate_minutes" between 1 and 100000);