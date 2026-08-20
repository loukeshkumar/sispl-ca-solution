ALTER TABLE "employee_profiles" ADD COLUMN "employment_end_date" date;--> statement-breakpoint
UPDATE "employee_profiles" AS "profile"
SET "employment_end_date" = greatest(
  "profile"."joining_date",
  coalesce(
    (SELECT max("event"."occurred_at")::date
     FROM "audit_events" AS "event"
     WHERE "event"."tenant_id" = "profile"."tenant_id"
       AND "event"."resource_type" = 'employee'
       AND "event"."resource_id" = "profile"."id"
       AND "event"."action" = 'employee.disabled'),
    current_date
  )
)
WHERE EXISTS (
  SELECT 1 FROM "tenant_memberships" AS "membership"
  WHERE "membership"."tenant_id" = "profile"."tenant_id"
    AND "membership"."user_id" = "profile"."user_id"
    AND "membership"."status" = 'disabled'
);--> statement-breakpoint
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_employment_dates_check" CHECK ("employee_profiles"."employment_end_date" is null or "employee_profiles"."employment_end_date" >= "employee_profiles"."joining_date");
