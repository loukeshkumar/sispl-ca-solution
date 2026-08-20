import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getTableName } from "drizzle-orm";

import { employeeProfiles, officeTasks } from "../db/schema";

test("employee profiles and office tasks have dedicated database tables", () => {
  assert.equal(getTableName(employeeProfiles), "employee_profiles");
  assert.equal(getTableName(officeTasks), "office_tasks");
});

test("user roles use tenant-scoped definitions, permissions, and membership assignments", async () => {
  const schema = await import("../db/schema") as Record<string, unknown>;
  assert.equal(getTableName(schema.roleDefinitions as Parameters<typeof getTableName>[0]), "role_definitions");
  assert.equal(getTableName(schema.rolePermissions as Parameters<typeof getTableName>[0]), "role_permissions");
  const source = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  for (const constraint of ["role_definitions_tenant_id_unique", "role_permissions_role_tenant_fk", "tenant_memberships_role_definition_fk", "tenant_memberships_super_admin_check"]) assert.match(source, new RegExp(constraint));
});

test("personal to-dos have an owner-private table and lifecycle constraints", async () => {
  const schema = await import("../db/schema") as Record<string, unknown>;
  assert.ok(schema.personalTodos, "personalTodos table should be exported");
  assert.equal(getTableName(schema.personalTodos as Parameters<typeof getTableName>[0]), "personal_todos");
  const source = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  assert.match(source, /employmentEndDate:\s*date\("employment_end_date"/);
  for (const constraint of [
    "personal_todos_owner_membership_fk",
    "personal_todos_owner_status_due_idx",
    "personal_todos_priority_check",
    "personal_todos_status_check",
    "personal_todos_completed_state_check",
    "personal_todos_archived_state_check",
  ]) assert.match(source, new RegExp(constraint));
  for (const field of ["policyId: uuid(\"policy_id\")", "periodScheduledHalfDays: integer(\"period_scheduled_half_days\")", "employmentExcludedHalfDays: integer(\"employment_excluded_half_days\")"]) assert.ok(source.includes(field));
});

test("attendance stores policy, immutable events, requests, periods, and locked summaries", async () => {
  const schema = await import("../db/schema") as Record<string, unknown>;
  const tables = {
    attendancePolicies: "attendance_policies",
    employeeWorkProfiles: "employee_work_profiles",
    attendanceDays: "attendance_days",
    attendanceEvents: "attendance_events",
    leaveRequests: "leave_requests",
    attendanceCorrectionRequests: "attendance_correction_requests",
    attendancePeriods: "attendance_periods",
    attendancePeriodSummaries: "attendance_period_summaries",
  };
  for (const [exportName, tableName] of Object.entries(tables)) {
    assert.ok(schema[exportName], `${exportName} should be exported`);
    assert.equal(getTableName(schema[exportName] as Parameters<typeof getTableName>[0]), tableName);
  }
  const source = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  for (const constraint of [
    "employee_work_profiles_employee_membership_fk", "attendance_days_employee_membership_fk",
    "attendance_days_tenant_employee_date_unique", "attendance_events_day_tenant_fk",
    "leave_requests_status_check", "attendance_corrections_pending_unique",
    "attendance_periods_tenant_period_unique", "attendance_periods_locked_state_check",
    "attendance_summaries_period_employee_unique", "attendance_summaries_units_check",
  ]) assert.match(source, new RegExp(constraint));
  assert.match(source, /employmentProrationDeductionPaise:\s*bigint\("employment_proration_deduction_paise"/);
  assert.match(source, /policyId:\s*uuid\("policy_id"\)\.notNull\(\)/);
  assert.match(source, /attendance_policies_effective_month_check/);
});

test("payroll stores effective salary versions and immutable attendance-linked run snapshots", async () => {
  const schema = await import("../db/schema") as Record<string, unknown>;
  const tables = {
    salaryStructures: "salary_structures",
    salaryStructureLines: "salary_structure_lines",
    payrollRuns: "payroll_runs",
    payrollEntries: "payroll_entries",
    payrollEntryLines: "payroll_entry_lines",
  };
  for (const [exportName, tableName] of Object.entries(tables)) {
    assert.ok(schema[exportName], `${exportName} should be exported`);
    assert.equal(getTableName(schema[exportName] as Parameters<typeof getTableName>[0]), tableName);
  }
  const source = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  for (const constraint of [
    "salary_structures_employee_effective_unique", "salary_lines_structure_code_unique",
    "salary_lines_amount_check", "payroll_runs_tenant_period_unique",
    "payroll_runs_status_check", "payroll_runs_state_timestamps_check",
    "payroll_entries_run_employee_unique", "payroll_entries_money_check",
    "payroll_entry_lines_amount_check",
  ]) assert.match(source, new RegExp(constraint));
});

test("database health check includes every attendance and payroll dependency", async () => {
  const source = await readFile(new URL("../scripts/db/check.ts", import.meta.url), "utf8");
  for (const table of [
    "role_definitions", "role_permissions", "personal_todos", "attendance_policies", "employee_work_profiles", "attendance_days", "attendance_events",
    "leave_requests", "attendance_correction_requests", "attendance_periods", "attendance_period_summaries",
    "salary_structures", "salary_structure_lines", "payroll_runs", "payroll_entries", "payroll_entry_lines",
  ]) assert.match(source, new RegExp(`"${table}"`), `database check is missing ${table}`);
});

test("client packages store tenant-scoped catalogues and immutable assignment snapshots", async () => {
  const schema = await import("../db/schema") as Record<string, unknown>;
  const tables = {
    serviceCatalog: "service_catalog",
    servicePackages: "service_packages",
    servicePackageItems: "service_package_items",
    clientPackageAssignments: "client_package_assignments",
    clientPackageAssignmentServices: "client_package_assignment_services",
  };
  for (const [exportName, tableName] of Object.entries(tables)) {
    assert.ok(schema[exportName], `${exportName} should be exported`);
    assert.equal(getTableName(schema[exportName] as Parameters<typeof getTableName>[0]), tableName);
  }

  const source = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  for (const constraint of [
    "service_catalog_tenant_code_lower_unique",
    "service_catalog_status_check",
    "service_packages_billing_cycle_check",
    "service_packages_fee_check",
    "service_package_items_package_tenant_fk",
    "service_package_items_service_tenant_fk",
    "client_package_assignments_entity_tenant_fk",
    "client_package_assignments_package_tenant_fk",
    "client_package_assignments_creator_membership_fk",
    "client_package_assignments_dates_check",
    "client_package_assignments_status_check",
    "client_package_assignments_fee_check",
    "client_package_assignment_services_assignment_tenant_fk",
    "client_package_assignment_services_service_tenant_fk",
    "client_package_assignment_services_source_check",
    "client_package_assignment_services_assignment_service_unique",
  ]) assert.match(source, new RegExp(constraint), `schema is missing ${constraint}`);

  const checkSource = await readFile(new URL("../scripts/db/check.ts", import.meta.url), "utf8");
  for (const tableName of Object.values(tables)) {
    assert.match(checkSource, new RegExp(`"${tableName}"`), `database check is missing ${tableName}`);
  }
});
