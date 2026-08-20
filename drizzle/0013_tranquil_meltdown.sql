DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "attendance_policies" WHERE extract(day from "effective_from") <> 1) THEN
    RAISE EXCEPTION 'Attendance policy migration requires every effective date to be the first day of its month.';
  END IF;
END $$;--> statement-breakpoint
UPDATE "attendance_periods"
SET "policy_id" = (
  SELECT "attendance_policies"."id"
  FROM "attendance_policies"
  WHERE "attendance_policies"."tenant_id" = "attendance_periods"."tenant_id"
    AND "attendance_policies"."effective_from" <= (("attendance_periods"."period_key" || '-01')::date + interval '1 month - 1 day')::date
  ORDER BY "attendance_policies"."effective_from" DESC
  LIMIT 1
)
WHERE "attendance_periods"."policy_id" IS NULL;--> statement-breakpoint
INSERT INTO "attendance_policies" (
  "id", "tenant_id", "effective_from", "jurisdiction_state", "time_zone", "working_week_mask",
  "standard_start_time", "standard_end_time", "late_grace_minutes", "full_day_minutes", "half_day_minutes", "created_by_user_id"
)
SELECT
  gen_random_uuid(), "attendance_periods"."tenant_id", ("attendance_periods"."period_key" || '-01')::date,
  'Bihar', 'Asia/Kolkata', '1111110', '09:30', '18:00', 15, 450, 225,
  COALESCE(
    "attendance_periods"."locked_by_user_id",
    "attendance_periods"."reviewed_by_user_id",
    (SELECT "tenant_memberships"."user_id" FROM "tenant_memberships"
      WHERE "tenant_memberships"."tenant_id" = "attendance_periods"."tenant_id"
      ORDER BY "tenant_memberships"."created_at" LIMIT 1)
  )
FROM "attendance_periods"
WHERE "attendance_periods"."policy_id" IS NULL
  AND COALESCE(
    "attendance_periods"."locked_by_user_id",
    "attendance_periods"."reviewed_by_user_id",
    (SELECT "tenant_memberships"."user_id" FROM "tenant_memberships"
      WHERE "tenant_memberships"."tenant_id" = "attendance_periods"."tenant_id"
      ORDER BY "tenant_memberships"."created_at" LIMIT 1)
  ) IS NOT NULL
ON CONFLICT ("tenant_id", "effective_from") DO NOTHING;--> statement-breakpoint
UPDATE "attendance_periods"
SET "policy_id" = (
  SELECT "attendance_policies"."id"
  FROM "attendance_policies"
  WHERE "attendance_policies"."tenant_id" = "attendance_periods"."tenant_id"
    AND "attendance_policies"."effective_from" <= (("attendance_periods"."period_key" || '-01')::date + interval '1 month - 1 day')::date
  ORDER BY "attendance_policies"."effective_from" DESC
  LIMIT 1
)
WHERE "attendance_periods"."policy_id" IS NULL;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "attendance_periods" WHERE "policy_id" IS NULL) THEN
    RAISE EXCEPTION 'Every attendance period must have an immutable attendance policy snapshot.';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "attendance_periods" ALTER COLUMN "policy_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_policies" ADD CONSTRAINT "attendance_policies_effective_month_check" CHECK (extract(day from "attendance_policies"."effective_from") = 1);
