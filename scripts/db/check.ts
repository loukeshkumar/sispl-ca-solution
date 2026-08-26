import { readPostgresConfig } from "../../lib/dashboard/config";
import { closePostgresPool, getPostgresPool } from "../../lib/dashboard/postgres/pool";

const requiredTables = [
  "tenants",
  "users",
  "user_credentials",
  "user_sessions",
  "auth_rate_limits",
  "tenant_memberships",
  "role_definitions",
  "role_permissions",
  "employee_profiles",
  "client_groups",
  "legal_entities",
  "client_services",
  "service_catalog",
  "service_packages",
  "service_package_items",
  "client_package_assignments",
  "client_package_assignment_services",
  "registrations",
  "compliance_schedules",
  "statutory_rate_versions",
  "statutory_rate_parameters",
  "filing_acknowledgements",
  "udin_registrations",
  "dsc_certificates",
  "dsc_custody_events",
  "statutory_notices",
  "time_entries",
  "work_items",
  "office_tasks",
  "personal_todos",
  "attendance_policies",
  "leave_types",
  "holiday_calendar",
  "shift_types",
  "employee_work_profiles",
  "attendance_days",
  "attendance_events",
  "leave_requests",
  "attendance_correction_requests",
  "attendance_periods",
  "attendance_period_summaries",
  "salary_structures",
  "salary_structure_lines",
  "payroll_runs",
  "payroll_entries",
  "payroll_entry_lines",
  "employee_bank_accounts",
  "payroll_disbursements",
  "document_checklist_items",
  "document_requests",
  "documents",
  "client_portal_users",
  "client_portal_credentials",
  "client_portal_sessions",
  "invoices",
  "invoice_lines",
  "notifications",
  "notification_deliveries",
  "audit_events",
];

async function main() {
  const config = readPostgresConfig(process.env);
  const pool = getPostgresPool();
  const server = await pool.query<{ database: string; version: string }>(
    "select current_database() as database, current_setting('server_version') as version",
  );
  const tables = await pool.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = 'public' and table_name = any($1::text[])",
    [requiredTables],
  );
  const found = new Set(tables.rows.map((row) => row.table_name));
  const missing = requiredTables.filter((table) => !found.has(table));

  console.log(`PostgreSQL ${server.rows[0]?.version ?? "unknown"} at ${config.host}:${config.port}`);
  console.log(`Database: ${server.rows[0]?.database ?? config.database}`);
  console.log(missing.length ? `Missing tables: ${missing.join(", ")}` : `Required tables: ${requiredTables.length}/${requiredTables.length}`);
  if (missing.length) process.exitCode = 1;
}

main()
  .catch(() => {
    console.error("Database check failed. Verify DATABASE_URL and PostgreSQL availability.");
    process.exitCode = 1;
  })
  .finally(closePostgresPool);
