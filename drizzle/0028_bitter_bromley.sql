ALTER TABLE "service_catalog" ADD COLUMN "standard_minutes" integer;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "budget_minutes" integer;--> statement-breakpoint
CREATE INDEX "time_entries_work_idx" ON "time_entries" USING btree ("tenant_id","work_item_id");--> statement-breakpoint
CREATE INDEX "work_items_assignee_due_idx" ON "work_items" USING btree ("tenant_id","assignee_id","status","internal_due_date");--> statement-breakpoint
CREATE INDEX "work_items_reviewer_idx" ON "work_items" USING btree ("tenant_id","reviewer_id","status");--> statement-breakpoint
ALTER TABLE "service_catalog" ADD CONSTRAINT "service_catalog_standard_minutes_check" CHECK ("service_catalog"."standard_minutes" is null or "service_catalog"."standard_minutes" between 1 and 100000);--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_budget_minutes_check" CHECK ("work_items"."budget_minutes" is null or "work_items"."budget_minutes" between 1 and 100000);