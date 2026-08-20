import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { and, count, eq, inArray, ne } from "drizzle-orm";

import {
  attendanceDays, attendanceEvents, attendancePeriodSummaries, attendancePeriods, attendancePolicies, auditEvents, employeeBankAccounts,
  authRateLimits, clientGroups, clientServices, documentRequests, documents, employeeProfiles, employeeWorkProfiles,
  clientPackageAssignments, clientPackageAssignmentServices, clientPortalCredentials, clientPortalSessions, clientPortalUsers, filingAcknowledgements, invoiceLines, invoices, legalEntities, notificationDeliveries, notifications, officeTasks, payrollEntries, payrollEntryLines, payrollRuns, personalTodos, registrations,
  roleDefinitions, rolePermissions, salaryStructureLines, salaryStructures, tenantMemberships, tenants, userCredentials, userSessions, users, workItems,
  serviceCatalog, servicePackageItems, servicePackages, statutoryRateParameters, statutoryRateVersions,
} from "../db/schema";
import { changeRequiredPassword, clearFailedLogins, consumeLoginRateLimit, findLoginIdentity, createSessionRecord, findSessionByTokenHash, recordFailedLogin, revokeSessionByTokenHash } from "../lib/auth/repository";
import { createSessionToken, hashSessionToken } from "../lib/auth/tokens";
import { archiveClient, ClientRepositoryError, createClient, getClient360Data, updateClient } from "../lib/clients/repository";
import { SEEDED_TENANT_ID } from "../lib/dashboard/fixtures";
import { cancelDocumentRequest, createDocumentRequest, getDocumentMetadata, listDocumentWorkspace, recordDocumentUpload } from "../lib/documents/repository";
import { mapDashboardRecords } from "../lib/dashboard/mapper";
import { closePostgresPool, getDatabase, getPostgresPool } from "../lib/dashboard/postgres/pool";
import { loadDashboardRecords } from "../lib/dashboard/postgres/repository";
import { applyBulkWorkChange, completeWorkItem, createWorkItem, getWorkItem360, listWorkClients, listWorkMembers, updateWorkItem } from "../lib/work/repository";
import { getCapacityLanes, getQueueTotals, listWorkQueue } from "../lib/work/queue";
import { DEFAULT_WORK_QUEUE_PARAMS } from "../lib/work/queue-params";
import { getSeedCounts, seedDevelopmentData } from "../scripts/db/seed";
import { createEmployee, disableEmployee, getEmployee360, listEmployees, provisionEmployeeAccess, TeamRepositoryError, updateEmployee } from "../lib/team/repository";
import { applyBulkTaskChange, completeOfficeTask, createOfficeTask, getTask360, listTaskWorkspace, TaskRepositoryError, updateOfficeTask, updateOwnTaskStatus } from "../lib/tasks/repository";
import { getTaskCapacityLanes, listTaskQueue } from "../lib/tasks/queue";
import { DEFAULT_TASK_QUEUE_PARAMS } from "../lib/tasks/queue-params";
import { applyBulkTodoChange, archiveTodo, completeTodo, createTodo, getTodo, getTodoLoadStrip, listTodoWorkspace, renameTodoCategory, reopenTodo, TodoRepositoryError, updateTodo } from "../lib/todos/repository";
import { createAttendancePolicy, getAttendanceWorkspace, lockAttendancePeriod, moveAttendancePeriodToReview, prepareAttendancePeriod, recordManualAttendance, reopenAttendancePeriod, AttendanceRepositoryError } from "../lib/attendance/repository";
import { eligibleWorkingDateKeys, workingDateKeys } from "../lib/attendance/calculations";
import {
  approvePayrollRun, createPayrollRun, createSalaryStructure, getPayrollRunDetail, getPublishedPayslip,
  listSalaryWorkspace, markPayrollPaid, PayrollRepositoryError, publishPayslips, submitPayrollRun, updatePayrollEntryInputs,
} from "../lib/payroll/repository";
import {
  assignClientPackage, cancelClientPackage, createPackage, createService, getAssignmentDetail, listActiveServiceOptions, listPackageSetupWorkspace, listServiceManagementWorkspace,
  PackageRepositoryError, updatePackage, updateService,
} from "../lib/packages/repository";
import { createRoleDefinition, getRoleDefinitionEditorData, RoleRepositoryError, updateRoleDefinition } from "../lib/roles/repository";
import { generateRecurringWorkItems } from "../lib/compliance/repository";
import { BillingRepositoryError, cancelInvoice, createInvoice, getInvoiceDetail, issueInvoice, recordInvoicePayment } from "../lib/billing/repository";
import { generateDeadlineNotifications } from "../lib/notifications/repository";
import {
  createPortalSessionRecord, disablePortalContact, findPortalLoginIdentity, findPortalSessionByTokenHash,
  getPortalDocumentRequest, getPortalOverview, provisionPortalContact,
} from "../lib/portal/repository";
import { verifyPassword } from "../lib/auth/password";
import { FilingRepositoryError, listFilingAcknowledgements, loadTallyInvoiceExport, loadTallyLedgerExport, recordFilingAcknowledgement } from "../lib/filings/repository";
import { buildTallyLedgerXml, buildTallySalesVoucherXml, voucherBalances } from "../lib/integrations/tally";
import { resolveRateVersion, suggestStatutoryDeductions } from "../lib/statutory/repository";
import { getActiveBankAccount, replaceBankAccount } from "../lib/payroll/bank-accounts";
import { DisbursementError, prepareDisbursement } from "../lib/payroll/disbursement-repository";

const FOREIGN_TENANT_ID = "10000000-0000-4000-8000-000000000099";
const databaseUrl = process.env.DATABASE_URL;

before(() => {
  assert.ok(databaseUrl, "DATABASE_URL is required; create .env.local from .env.example before running integration tests.");
});

after(async () => {
  await closePostgresPool();
});

test("configured PostgreSQL accepts a basic query", async () => {
  const result = await getPostgresPool().query<{ value: number }>("select 1::int as value");
  assert.equal(result.rows[0]?.value, 1);
});

test("development seed is idempotent and loads the expected dashboard rows", async () => {
  const database = getDatabase();
  await seedDevelopmentData(database);
  const firstCounts = await getSeedCounts(database, SEEDED_TENANT_ID);
  await seedDevelopmentData(database);
  const secondCounts = await getSeedCounts(database, SEEDED_TENANT_ID);

  assert.deepEqual(secondCounts, firstCounts);
  assert.deepEqual(secondCounts, {
    attendancePolicies: 1,
    tenants: 1,
    clientGroups: 5,
    legalEntities: 5,
    workItems: 4,
    employeeProfiles: 5,
    officeTasks: 5,
    workProfiles: 5,
  });

  const records = await loadDashboardRecords(database, SEEDED_TENANT_ID);
  assert.equal(records.clients.length, 5);
  assert.equal(records.workItems.length, 4);
});

test("service master lifecycle controls active options without deleting history", async () => {
  const database = getDatabase();
  await seedDevelopmentData(database);
  const identity = await findLoginIdentity(database, "loukesh@example.invalid", "sharma-kumar-ca");
  assert.ok(identity);
  const suffix = randomUUID().slice(0, 6).toUpperCase();
  const code = `VCFO_${suffix}`;
  const serviceId = await createService(database, identity.tenantId, identity.userId, {
      standardMinutes: null,
    category: "Advisory", code, description: "Virtual finance leadership", name: `Virtual CFO ${suffix}`, status: "active",
  });
  try {
    const workspace = await listServiceManagementWorkspace(database, identity.tenantId);
    assert.equal(workspace.services.find((service) => service.id === serviceId)?.code, code);
    assert.equal((await listActiveServiceOptions(database, identity.tenantId)).some((service) => service.id === serviceId), true);
    assert.equal((await listServiceManagementWorkspace(database, FOREIGN_TENANT_ID)).services.some((service) => service.id === serviceId), false);
    await updateService(database, identity.tenantId, identity.userId, serviceId, {
      standardMinutes: null,
      category: "Advisory", code, description: "Retained for historical traceability", name: `Virtual CFO ${suffix}`, status: "archived",
    });
    assert.equal((await listActiveServiceOptions(database, identity.tenantId)).some((service) => service.id === serviceId), false);
  } finally {
    await database.delete(auditEvents).where(and(eq(auditEvents.resourceType, "service_catalog"), eq(auditEvents.resourceId, serviceId)));
    await database.delete(serviceCatalog).where(eq(serviceCatalog.id, serviceId));
  }
});

test("client package assignments preserve immutable snapshots and tenant boundaries", async () => {
  const database = getDatabase();
  await seedDevelopmentData(database);
  const identity = await findLoginIdentity(database, "loukesh@example.invalid", "sharma-kumar-ca");
  assert.ok(identity);
  const [client] = await database.select({ id: legalEntities.id }).from(legalEntities).where(eq(legalEntities.tenantId, identity.tenantId)).limit(1);
  assert.ok(client);
  const originalServices = await database.select({ serviceKey: clientServices.serviceKey, status: clientServices.status }).from(clientServices).where(and(
    eq(clientServices.tenantId, identity.tenantId), eq(clientServices.legalEntityId, client.id),
  ));
  const setup = await listPackageSetupWorkspace(database, identity.tenantId);
  assert.ok(setup.services.length >= 3);
  const included = setup.services.slice(0, 2).map((service) => service.id);
  const addon = setup.services[2]!;
  let packageId = "";
  let assignmentId = "";

  try {
    packageId = await createPackage(database, identity.tenantId, identity.userId, {
      billingCycle: "monthly", code: `PKG_${randomUUID().slice(0, 6).toUpperCase()}`, description: "Integration package",
      name: "Snapshot package", serviceIds: included, standardFeePaise: 500_000, status: "active",
    });
    assignmentId = await assignClientPackage(database, identity.tenantId, identity.userId, {
      addonServiceIds: [addon.id], agreedFeePaise: 450_000, effectiveFrom: "2030-01-01", effectiveTo: "2030-12-31",
      legalEntityId: client.id, packageId, replaceExisting: false,
    }, "2030-01-15");
    const original = await getAssignmentDetail(database, identity.tenantId, assignmentId);
    assert.equal(original?.packageName, "Snapshot package");
    assert.equal(original?.agreedFeePaise, 450_000);
    assert.equal(original?.services.length, 3);
    assert.equal(original?.services.filter((service) => service.source === "addon").length, 1);
    assert.equal(await getAssignmentDetail(database, FOREIGN_TENANT_ID, assignmentId), null);

    await updatePackage(database, identity.tenantId, identity.userId, packageId, {
      billingCycle: "annual", code: original!.packageCode, description: "Changed catalogue package",
      name: "Renamed package", serviceIds: [included[0]!], standardFeePaise: 6_000_000, status: "active",
    });
    const snapshotAfterEdit = await getAssignmentDetail(database, identity.tenantId, assignmentId);
    assert.equal(snapshotAfterEdit?.packageName, "Snapshot package");
    assert.equal(snapshotAfterEdit?.billingCycle, "monthly");
    assert.equal(snapshotAfterEdit?.standardFeePaise, 500_000);
    assert.equal(snapshotAfterEdit?.services.length, 3);

    await assert.rejects(
      () => assignClientPackage(database, identity.tenantId, identity.userId, {
        addonServiceIds: [], agreedFeePaise: 600_000, effectiveFrom: "2030-06-01", effectiveTo: null,
        legalEntityId: client.id, packageId, replaceExisting: false,
      }, "2030-01-15"),
      (error: unknown) => error instanceof PackageRepositoryError && error.code === "replace_required",
    );

    const entitlementRows = await database.select({ serviceKey: clientServices.serviceKey }).from(clientServices).where(and(
      eq(clientServices.tenantId, identity.tenantId), eq(clientServices.legalEntityId, client.id), eq(clientServices.status, "active"),
    ));
    assert.deepEqual(new Set(entitlementRows.map((row) => row.serviceKey)), new Set(original!.services.map((service) => service.code)));
    await cancelClientPackage(database, identity.tenantId, identity.userId, assignmentId, "Client agreement ended", "2030-01-15");
    assert.equal((await getAssignmentDetail(database, identity.tenantId, assignmentId))?.status, "cancelled");
  } finally {
    if (assignmentId || packageId) await database.delete(auditEvents).where(and(
      eq(auditEvents.tenantId, identity.tenantId), inArray(auditEvents.resourceId, [assignmentId, packageId].filter(Boolean)),
    ));
    if (assignmentId) {
      await database.delete(clientPackageAssignmentServices).where(and(eq(clientPackageAssignmentServices.tenantId, identity.tenantId), eq(clientPackageAssignmentServices.assignmentId, assignmentId)));
      await database.delete(clientPackageAssignments).where(and(eq(clientPackageAssignments.tenantId, identity.tenantId), eq(clientPackageAssignments.id, assignmentId)));
    }
    if (packageId) {
      await database.delete(servicePackageItems).where(and(eq(servicePackageItems.tenantId, identity.tenantId), eq(servicePackageItems.packageId, packageId)));
      await database.delete(servicePackages).where(and(eq(servicePackages.tenantId, identity.tenantId), eq(servicePackages.id, packageId)));
    }
    await database.delete(clientServices).where(and(eq(clientServices.tenantId, identity.tenantId), eq(clientServices.legalEntityId, client.id)));
    if (originalServices.length) await database.insert(clientServices).values(originalServices.map((service) => ({
      tenantId: identity.tenantId, legalEntityId: client.id, serviceKey: service.serviceKey, status: service.status,
    })));
  }
});

test("attendance lock drives controlled payroll, publication, payment, and private payslip access", async () => {
  const database = getDatabase();
  const tenantId = randomUUID();
  const administratorUserId = randomUUID();
  const partnerUserId = randomUUID();
  const employeeUserId = randomUUID();
  const otherEmployeeUserId = randomUUID();
  const periodKey = "2031-01";
  let periodId = "";
  let runId = "";

  try {
    await database.insert(tenants).values({ id: tenantId, legalName: "Payroll integration firm", displayName: "Payroll integration firm", slug: `payroll-${tenantId}` });
    await database.insert(users).values([
      { id: administratorUserId, email: `administrator-${tenantId}@example.invalid`, fullName: "Payroll Administrator" },
      { id: partnerUserId, email: `partner-${tenantId}@example.invalid`, fullName: "Approving Partner" },
      { id: employeeUserId, email: `employee-${tenantId}@example.invalid`, fullName: "Payroll Employee" },
      { id: otherEmployeeUserId, email: `other-${tenantId}@example.invalid`, fullName: "Other Employee" },
    ]);
    await database.insert(tenantMemberships).values([
      { id: randomUUID(), tenantId, userId: administratorUserId, roleKey: "firm_administrator", status: "active" },
      { id: randomUUID(), tenantId, userId: partnerUserId, roleKey: "partner", status: "active" },
      { id: randomUUID(), tenantId, userId: employeeUserId, roleKey: "associate", status: "active" },
      { id: randomUUID(), tenantId, userId: otherEmployeeUserId, roleKey: "associate", status: "active" },
    ]);
    await database.insert(employeeProfiles).values({
      id: randomUUID(), tenantId, userId: employeeUserId, employeeCode: "PAY-0001", designation: "Audit Associate", joiningDate: "2031-01-16",
    });
    await database.insert(employeeWorkProfiles).values({
      id: randomUUID(), tenantId, employeeUserId, managerUserId: partnerUserId, employmentType: "employee", workLocationState: "Bihar",
    });
    await database.insert(attendancePolicies).values({
      id: randomUUID(), tenantId, effectiveFrom: "2030-01-01", jurisdictionState: "Bihar", timeZone: "Asia/Kolkata",
      workingWeekMask: "1111110", standardStartTime: "09:30", standardEndTime: "18:00", lateGraceMinutes: 15,
      fullDayMinutes: 450, halfDayMinutes: 225, createdByUserId: administratorUserId,
    });

    periodId = await prepareAttendancePeriod(database, tenantId, administratorUserId, periodKey);
    await assert.rejects(
      () => createAttendancePolicy(database, tenantId, administratorUserId, {
        effectiveFrom: "2031-01-01", jurisdictionState: "Bihar", timeZone: "Asia/Kolkata", workingWeekMask: "1111110",
        standardStartTime: "10:00", standardEndTime: "18:30", lateGraceMinutes: 10, fullDayMinutes: 450, halfDayMinutes: 225,
      }),
      (error: unknown) => error instanceof AttendanceRepositoryError && error.code === "invalid_state",
    );
    for (const attendanceDate of eligibleWorkingDateKeys(periodKey, "1111110", "2031-01-16", null)) await recordManualAttendance(
      database, tenantId, administratorUserId, "firm_administrator", employeeUserId,
      { attendanceDate, checkInTime: "09:30", checkOutTime: "18:00", note: "Verified integration attendance", status: "present" },
    );
    await moveAttendancePeriodToReview(database, tenantId, administratorUserId, periodId);
    await lockAttendancePeriod(database, tenantId, administratorUserId, periodId);
    const [lockedPeriod] = await database.select({ policyId: attendancePeriods.policyId, status: attendancePeriods.status }).from(attendancePeriods).where(and(eq(attendancePeriods.tenantId, tenantId), eq(attendancePeriods.id, periodId)));
    assert.equal(lockedPeriod?.status, "locked");
    assert.ok(lockedPeriod?.policyId);
    await assert.rejects(
      () => createAttendancePolicy(database, tenantId, administratorUserId, {
        effectiveFrom: "2031-01-20", jurisdictionState: "Bihar", timeZone: "Asia/Kolkata", workingWeekMask: "1111110",
        standardStartTime: "10:00", standardEndTime: "18:30", lateGraceMinutes: 10, fullDayMinutes: 450, halfDayMinutes: 225,
      }),
      (error: unknown) => error instanceof AttendanceRepositoryError && error.code === "invalid_state",
    );

    await createSalaryStructure(database, tenantId, administratorUserId, {
      employeeUserId, effectiveFrom: "2030-01-01", lines: [
        { code: "BASIC", label: "Basic salary", kind: "earning", monthlyAmountPaise: 3_000_000 },
        { code: "HRA", label: "House rent allowance", kind: "earning", monthlyAmountPaise: 1_200_000 },
        { code: "REC_DED", label: "Recurring deduction", kind: "deduction", monthlyAmountPaise: 50_000 },
      ],
    });
    runId = await createPayrollRun(database, tenantId, administratorUserId, periodKey, "2031-02-07");
    let draft = await getPayrollRunDetail(database, tenantId, administratorUserId, runId);
    assert.equal(draft?.run.status, "draft");
    assert.equal(draft?.entries.length, 1);
    assert.equal(draft?.entries[0]?.periodScheduledHalfDays, workingDateKeys(periodKey, "1111110").length * 2);
    assert.equal(draft?.entries[0]?.employmentExcludedHalfDays, 26);
    assert.equal(draft?.entries[0]?.earnedGrossPaise, 2_177_778);
    assert.equal(draft?.entries[0]?.employmentProrationDeductionPaise, 2_022_222);
    assert.equal(draft?.entries[0]?.netPayPaise, 2_127_778);

    await reopenAttendancePeriod(database, tenantId, administratorUserId, periodId, "Correct attendance before submission");
    assert.equal(await getPayrollRunDetail(database, tenantId, administratorUserId, runId), null);
    await moveAttendancePeriodToReview(database, tenantId, administratorUserId, periodId);
    await lockAttendancePeriod(database, tenantId, administratorUserId, periodId);
    runId = await createPayrollRun(database, tenantId, administratorUserId, periodKey, "2031-02-07");
    draft = await getPayrollRunDetail(database, tenantId, administratorUserId, runId);

    await updatePayrollEntryInputs(database, tenantId, administratorUserId, runId, {
      employeeUserId, employeeProvidentFundPaise: 100_000, employeeStateInsurancePaise: 20_000,
      hold: false, holdReason: "",
      professionalTaxPaise: 20_000, incomeTaxPaise: 150_000, oneTimeAdditionPaise: 10_000,
      oneTimeDeductionPaise: 5_000, note: "Statutory amounts reviewed",
    });
    const employeeBeforePublication = await listSalaryWorkspace(database, tenantId, employeeUserId, "associate", periodKey);
    assert.deepEqual(employeeBeforePublication.runs, []);
    assert.deepEqual(employeeBeforePublication.employees, []);
    assert.equal(employeeBeforePublication.ownPayslips.length, 0);

    await submitPayrollRun(database, tenantId, administratorUserId, runId);
    await assert.rejects(
      () => approvePayrollRun(database, tenantId, administratorUserId, "firm_administrator", runId, ""),
      (error: unknown) => error instanceof PayrollRepositoryError && error.code === "override_reason_required",
    );
    assert.equal(await getPublishedPayslip(database, tenantId, employeeUserId, draft!.entries[0]!.id, false), null);
    await approvePayrollRun(database, tenantId, partnerUserId, "partner", runId, "Reviewed by partner");
    await publishPayslips(database, tenantId, partnerUserId, "partner", runId, "Release approved payslips");
    const payslip = await getPublishedPayslip(database, tenantId, employeeUserId, draft!.entries[0]!.id, false);
    assert.equal(payslip?.entry.employeeName, "Payroll Employee");
    assert.equal(await getPublishedPayslip(database, tenantId, otherEmployeeUserId, draft!.entries[0]!.id, false), null);
    const employeeAfterPublication = await listSalaryWorkspace(database, tenantId, employeeUserId, "associate", periodKey);
    assert.equal(employeeAfterPublication.ownPayslips.length, 1);
    await markPayrollPaid(database, tenantId, partnerUserId, "partner", runId, "BANK-2031-01-001", "Bank payment verified");
    assert.equal((await getPayrollRunDetail(database, tenantId, administratorUserId, runId))?.run.status, "paid");
    await assert.rejects(
      () => reopenAttendancePeriod(database, tenantId, administratorUserId, periodId, "Payroll correction"),
      (error: unknown) => error instanceof AttendanceRepositoryError && error.code === "payroll_dependency",
    );
    await assert.rejects(() => createPayrollRun(database, tenantId, administratorUserId, periodKey, "2031-02-07"));
  } finally {
    await database.delete(auditEvents).where(eq(auditEvents.tenantId, tenantId));
    await database.delete(payrollEntryLines).where(eq(payrollEntryLines.tenantId, tenantId));
    await database.delete(payrollEntries).where(eq(payrollEntries.tenantId, tenantId));
    await database.delete(payrollRuns).where(eq(payrollRuns.tenantId, tenantId));
    await database.delete(attendancePeriodSummaries).where(eq(attendancePeriodSummaries.tenantId, tenantId));
    await database.delete(attendanceEvents).where(eq(attendanceEvents.tenantId, tenantId));
    await database.delete(attendanceDays).where(eq(attendanceDays.tenantId, tenantId));
    await database.delete(attendancePeriods).where(eq(attendancePeriods.tenantId, tenantId));
    await database.delete(attendancePolicies).where(eq(attendancePolicies.tenantId, tenantId));
    await database.delete(salaryStructureLines).where(eq(salaryStructureLines.tenantId, tenantId));
    await database.delete(salaryStructures).where(eq(salaryStructures.tenantId, tenantId));
    await database.delete(employeeWorkProfiles).where(eq(employeeWorkProfiles.tenantId, tenantId));
    await database.delete(employeeProfiles).where(eq(employeeProfiles.tenantId, tenantId));
    await database.delete(tenantMemberships).where(eq(tenantMemberships.tenantId, tenantId));
    await database.delete(users).where(inArray(users.id, [administratorUserId, partnerUserId, employeeUserId, otherEmployeeUserId]));
    await database.delete(tenants).where(eq(tenants.id, tenantId));
  }
});

test("a different tenant id cannot read seeded client or work records", async () => {
  const database = getDatabase();
  const [clientCount] = await database.select({ value: count() }).from(legalEntities)
    .where(eq(legalEntities.tenantId, FOREIGN_TENANT_ID));
  const [workCount] = await database.select({ value: count() }).from(workItems)
    .where(eq(workItems.tenantId, FOREIGN_TENANT_ID));

  assert.equal(clientCount?.value, 0);
  assert.equal(workCount?.value, 0);

  const [seededDataVisibleThroughForeignTenant] = await database
    .select({ value: count() })
    .from(legalEntities)
    .innerJoin(clientGroups, and(
      eq(clientGroups.id, legalEntities.clientGroupId),
      eq(clientGroups.tenantId, FOREIGN_TENANT_ID),
    ))
    .innerJoin(tenants, eq(tenants.id, FOREIGN_TENANT_ID));
  assert.equal(seededDataVisibleThroughForeignTenant?.value, 0);
});

test("local authentication resolves an active membership and revocable opaque session", async () => {
  const database = getDatabase();
  const identity = await findLoginIdentity(database, "LOUKESH@EXAMPLE.INVALID", "sharma-kumar-ca");
  assert.ok(identity);
  assert.equal(identity.tenantId, SEEDED_TENANT_ID);
  assert.equal(identity.roleKey, "firm_administrator");
  assert.match(identity.passwordHash, /^scrypt\$/);
  assert.equal(await findLoginIdentity(database, identity.email, "another-firm"), null);

  const token = createSessionToken();
  const tokenHash = hashSessionToken(token);
  await createSessionRecord(database, {
    membershipId: identity.membershipId,
    tokenHash,
    expiresAt: new Date(Date.now() + 60_000),
  });

  const session = await findSessionByTokenHash(database, tokenHash);
  assert.equal(session?.userId, identity.userId);
  assert.equal(session?.tenantId, identity.tenantId);
  await revokeSessionByTokenHash(database, tokenHash);
  assert.equal(await findSessionByTokenHash(database, tokenHash), null);
  await database.delete(userSessions).where(eq(userSessions.tokenHash, tokenHash));
});

test("failed-login lockout remains correct under concurrent attempts", async () => {
  const database = getDatabase();
  const identity = await findLoginIdentity(database, "loukesh@example.invalid", "sharma-kumar-ca");
  assert.ok(identity);
  await clearFailedLogins(database, identity.userId);
  try {
    await Promise.all(Array.from({ length: 5 }, () => recordFailedLogin(database, identity, new Date("2026-08-16T10:00:00Z"))));
    const [credential] = await database.select({
      failedLoginAttempts: userCredentials.failedLoginAttempts,
      lockedUntil: userCredentials.lockedUntil,
    }).from(userCredentials).where(eq(userCredentials.userId, identity.userId));
    assert.equal(credential?.failedLoginAttempts, 0);
    assert.equal(credential?.lockedUntil?.toISOString(), "2026-08-16T10:15:00.000Z");
  } finally {
    await clearFailedLogins(database, identity.userId);
  }
});

test("database login throttling is atomic under concurrent requests", async () => {
  const database = getDatabase();
  const keyHash = randomUUID().replaceAll("-", "").padEnd(64, "0");
  const now = new Date("2026-08-16T10:00:00Z");
  try {
    const decisions = await Promise.all(Array.from({ length: 5 }, () => consumeLoginRateLimit(database, keyHash, now, 5)));
    assert.equal(decisions.filter(Boolean).length, 4);
    assert.equal(await consumeLoginRateLimit(database, keyHash, new Date(now.getTime() + 1), 5), false);
  } finally {
    await database.delete(authRateLimits).where(eq(authRateLimits.keyHash, keyHash));
  }
});

test("Super Admin governs delegated Admin roles and permission changes revoke active sessions", async () => {
  const database = getDatabase();
  const identity = await findLoginIdentity(database, "loukesh@example.invalid", "sharma-kumar-ca");
  assert.ok(identity);
  const suffix = randomUUID().slice(0, 8);
  const roleId = await createRoleDefinition(database, identity.tenantId, identity.userId, {
    description: "Limited employee administration for integration testing.",
    legacyRoleKey: "partner",
    name: `People Admin ${suffix}`,
    permissions: ["dashboard:read", "team:read", "team:manage", "roles:read"],
    roleClass: "admin",
  });
  let employeeId = "";
  let adminUserId = "";
  let membershipId = "";
  let tokenHash = "";
  try {
    const role = await getRoleDefinitionEditorData(database, identity.tenantId, roleId);
    assert.deepEqual(role?.permissions.sort(), ["dashboard:read", "roles:read", "team:manage", "team:read"]);
    const created = await createEmployee(database, identity.tenantId, identity.userId, {
      designation: "People Administrator", email: `people-admin-${suffix}@example.invalid`, fullName: `People Admin ${suffix}`,
      joiningDate: "2026-08-17", mobileNumber: "", notes: "Delegated Admin", roleDefinitionId: roleId,
    });
    employeeId = created.employeeId;
    adminUserId = created.userId;
    const [membership] = await database.select({ accessClass: tenantMemberships.accessClass, id: tenantMemberships.id }).from(tenantMemberships).where(and(eq(tenantMemberships.tenantId, identity.tenantId), eq(tenantMemberships.userId, adminUserId)));
    assert.equal(membership?.accessClass, "admin");
    assert.ok(membership);
    membershipId = membership.id;
    await provisionEmployeeAccess(database, identity.tenantId, identity.userId, employeeId);
    tokenHash = hashSessionToken(createSessionToken());
    await createSessionRecord(database, { membershipId, tokenHash, expiresAt: new Date(Date.now() + 60_000) });
    const adminSession = await findSessionByTokenHash(database, tokenHash);
    assert.equal(adminSession?.permissions.includes("team:manage"), true);
    assert.equal(adminSession?.permissions.includes("roles:manage"), false);
    await assert.rejects(
      () => createRoleDefinition(database, identity.tenantId, adminUserId, { description: "", legacyRoleKey: "associate", name: `Forbidden ${suffix}`, permissions: ["dashboard:read"], roleClass: "employee" }),
      (error: unknown) => error instanceof RoleRepositoryError && error.code === "forbidden",
    );
    await updateRoleDefinition(database, identity.tenantId, identity.userId, roleId, {
      description: "Read-only people administration.", legacyRoleKey: "partner", name: `People Admin ${suffix}`,
      permissions: ["dashboard:read", "team:read", "roles:read"], roleClass: "admin",
    });
    assert.equal(await findSessionByTokenHash(database, tokenHash), null);
  } finally {
    if (membershipId) await database.delete(userSessions).where(eq(userSessions.membershipId, membershipId));
    if (adminUserId) {
      await database.delete(userCredentials).where(eq(userCredentials.userId, adminUserId));
      await database.delete(employeeWorkProfiles).where(and(eq(employeeWorkProfiles.tenantId, identity.tenantId), eq(employeeWorkProfiles.employeeUserId, adminUserId)));
      await database.delete(employeeProfiles).where(eq(employeeProfiles.id, employeeId));
      await database.delete(tenantMemberships).where(and(eq(tenantMemberships.tenantId, identity.tenantId), eq(tenantMemberships.userId, adminUserId)));
      await database.delete(users).where(eq(users.id, adminUserId));
    }
    await database.delete(auditEvents).where(and(eq(auditEvents.tenantId, identity.tenantId), inArray(auditEvents.resourceId, [roleId, employeeId].filter(Boolean))));
    await database.delete(rolePermissions).where(and(eq(rolePermissions.tenantId, identity.tenantId), eq(rolePermissions.roleDefinitionId, roleId)));
    await database.delete(roleDefinitions).where(eq(roleDefinitions.id, roleId));
  }
});

test("composite tenant keys reject cross-tenant client relationships", async () => {
  const database = getDatabase();
  const foreignTenantId = randomUUID();
  const foreignGroupId = randomUUID();
  await database.insert(tenants).values({ id: foreignTenantId, legalName: "Foreign test firm", displayName: "Foreign test firm", slug: `foreign-${foreignTenantId}` });
  await database.insert(clientGroups).values({ id: foreignGroupId, tenantId: foreignTenantId, name: `Foreign group ${foreignGroupId}` });
  try {
    await assert.rejects(database.insert(legalEntities).values({
      id: randomUUID(), tenantId: SEEDED_TENANT_ID, clientGroupId: foreignGroupId,
      legalName: "Invalid cross tenant entity", displayName: "Invalid cross tenant entity",
      entityType: "Private Company", maskedPan: "AABCA••••F", city: "Patna", relationshipStart: "2026-08-16",
    }));
  } finally {
    await database.delete(clientGroups).where(eq(clientGroups.id, foreignGroupId));
    await database.delete(tenants).where(eq(tenants.id, foreignTenantId));
  }
});

test("employee lifecycle is tenant-scoped, provisions one-time access, and guards assigned work", async () => {
  const database = getDatabase();
  const identity = await findLoginIdentity(database, "loukesh@example.invalid", "sharma-kumar-ca");
  assert.ok(identity);
  const suffix = randomUUID().slice(0, 8);
  const created = await createEmployee(database, identity.tenantId, identity.userId, {
    designation: "Audit Associate",
    email: `employee-${suffix}@example.invalid`,
    fullName: `Employee ${suffix}`,
    joiningDate: "2026-08-16",
    mobileNumber: "+919876543210",
    notes: "Integration employee",
    roleKey: "associate",
  });
  let membershipId = "";
  let tokenHash = "";
  let taskId = "";
  try {
    const employee = await getEmployee360(database, identity.tenantId, created.employeeId);
    assert.equal(employee?.userId, created.userId);
    assert.equal(employee?.designation, "Audit Associate");
    const [workProfile] = await database.select({ employeeUserId: employeeWorkProfiles.employeeUserId }).from(employeeWorkProfiles).where(and(
      eq(employeeWorkProfiles.tenantId, identity.tenantId), eq(employeeWorkProfiles.employeeUserId, created.userId),
    ));
    assert.equal(workProfile?.employeeUserId, created.userId);
    assert.equal(await getEmployee360(database, FOREIGN_TENANT_ID, created.employeeId), null);
    assert.equal((await listEmployees(database, identity.tenantId)).some((item) => item.id === created.employeeId), true);

    const temporaryPassword = await provisionEmployeeAccess(database, identity.tenantId, identity.userId, created.employeeId);
    assert.equal(temporaryPassword.length, 20);
    const [credential] = await database.select({ mustChangePassword: userCredentials.mustChangePassword }).from(userCredentials).where(eq(userCredentials.userId, created.userId));
    assert.equal(credential?.mustChangePassword, true);
    const [membership] = await database.select({ id: tenantMemberships.id }).from(tenantMemberships).where(and(
      eq(tenantMemberships.tenantId, identity.tenantId),
      eq(tenantMemberships.userId, created.userId),
    ));
    assert.ok(membership);
    membershipId = membership.id;
    tokenHash = hashSessionToken(createSessionToken());
    await createSessionRecord(database, { membershipId, tokenHash, expiresAt: new Date(Date.now() + 60_000) });
    const temporaryIdentity = await findLoginIdentity(database, `employee-${suffix}@example.invalid`, "sharma-kumar-ca");
    assert.equal(temporaryIdentity?.mustChangePassword, true);
    await changeRequiredPassword(database, created.userId, temporaryPassword, "Strong replacement 2026!");
    assert.equal(await findSessionByTokenHash(database, tokenHash), null);
    const [changedCredential] = await database.select({ mustChangePassword: userCredentials.mustChangePassword }).from(userCredentials).where(eq(userCredentials.userId, created.userId));
    assert.equal(changedCredential?.mustChangePassword, false);
    tokenHash = hashSessionToken(createSessionToken());
    await createSessionRecord(database, { membershipId, tokenHash, expiresAt: new Date(Date.now() + 60_000) });

    taskId = randomUUID();
    await database.insert(officeTasks).values({
      id: taskId,
      tenantId: identity.tenantId,
      title: "Outstanding employee task",
      assigneeId: created.userId,
      assignedByUserId: identity.userId,
      priority: "normal",
      status: "todo",
      dueDate: "2026-08-31",
    });
    await assert.rejects(
      () => disableEmployee(database, identity.tenantId, identity.userId, created.employeeId),
      (error: unknown) => error instanceof TeamRepositoryError && error.code === "active_tasks",
    );
    await database.delete(officeTasks).where(eq(officeTasks.id, taskId));
    taskId = "";
    await disableEmployee(database, identity.tenantId, identity.userId, created.employeeId, new Date("2026-08-16T10:00:00+05:30"));
    assert.equal(await findSessionByTokenHash(database, tokenHash), null);
    const [disabled] = await database.select({ status: tenantMemberships.status }).from(tenantMemberships).where(eq(tenantMemberships.id, membershipId));
    assert.equal(disabled?.status, "disabled");
    await recordManualAttendance(database, identity.tenantId, identity.userId, "firm_administrator", created.userId, {
      attendanceDate: "2026-08-16", checkInTime: "09:30", checkOutTime: "18:00", note: "Final attendance correction", status: "present",
    });
    const formerMember = (await getAttendanceWorkspace(database, identity.tenantId, identity.userId, "firm_administrator", "2026-08")).team.find((member) => member.userId === created.userId);
    assert.equal(formerMember?.membershipStatus, "disabled");
    assert.equal(formerMember?.employmentEndDate, "2026-08-16");
  } finally {
    if (taskId) await database.delete(officeTasks).where(eq(officeTasks.id, taskId));
    if (membershipId) await database.delete(userSessions).where(eq(userSessions.membershipId, membershipId));
    await database.delete(auditEvents).where(eq(auditEvents.resourceId, created.employeeId));
    await database.delete(attendanceEvents).where(and(eq(attendanceEvents.tenantId, identity.tenantId), eq(attendanceEvents.employeeUserId, created.userId)));
    await database.delete(attendanceDays).where(and(eq(attendanceDays.tenantId, identity.tenantId), eq(attendanceDays.employeeUserId, created.userId)));
    await database.delete(userCredentials).where(eq(userCredentials.userId, created.userId));
    await database.delete(employeeWorkProfiles).where(and(eq(employeeWorkProfiles.tenantId, identity.tenantId), eq(employeeWorkProfiles.employeeUserId, created.userId)));
    await database.delete(employeeProfiles).where(eq(employeeProfiles.id, created.employeeId));
    await database.delete(tenantMemberships).where(and(eq(tenantMemberships.tenantId, identity.tenantId), eq(tenantMemberships.userId, created.userId)));
    await database.delete(users).where(eq(users.id, created.userId));
  }
});

test("employee disabling and task assignment serialize on the membership boundary", async () => {
  const database = getDatabase();
  const identity = await findLoginIdentity(database, "loukesh@example.invalid", "sharma-kumar-ca");
  assert.ok(identity);
  const suffix = randomUUID().slice(0, 8);
  const created = await createEmployee(database, identity.tenantId, identity.userId, {
    designation: "Concurrency Associate",
    email: `concurrency-${suffix}@example.invalid`,
    fullName: `Concurrency ${suffix}`,
    joiningDate: "2026-08-16",
    mobileNumber: "",
    notes: "Membership locking test",
    roleKey: "associate",
  });
  let taskId = "";
  try {
    const results = await Promise.allSettled([
      createOfficeTask(database, identity.tenantId, identity.userId, {
        assigneeId: created.userId,
        blockerNote: "",
        estimateMinutes: null,
        description: "Concurrent assignment integrity check.",
        dueDate: "2026-08-30",
        legalEntityId: null,
        priority: "normal",
        reviewerId: null,
        status: "todo",
        title: "Concurrent membership task",
        workItemId: null,
      }),
      disableEmployee(database, identity.tenantId, identity.userId, created.employeeId),
    ]);
    if (results[0].status === "fulfilled") taskId = results[0].value;
    const [membership] = await database.select({ status: tenantMemberships.status }).from(tenantMemberships).where(and(
      eq(tenantMemberships.tenantId, identity.tenantId),
      eq(tenantMemberships.userId, created.userId),
    ));
    const [taskCount] = await database.select({ value: count() }).from(officeTasks).where(and(
      eq(officeTasks.tenantId, identity.tenantId),
      eq(officeTasks.assigneeId, created.userId),
    ));
    assert.equal(membership?.status === "disabled" && Number(taskCount?.value) > 0, false);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  } finally {
    if (taskId) {
      await database.delete(auditEvents).where(eq(auditEvents.resourceId, taskId));
      await database.delete(officeTasks).where(eq(officeTasks.id, taskId));
    }
    await database.delete(auditEvents).where(eq(auditEvents.resourceId, created.employeeId));
    await database.delete(employeeWorkProfiles).where(and(eq(employeeWorkProfiles.tenantId, identity.tenantId), eq(employeeWorkProfiles.employeeUserId, created.userId)));
    await database.delete(employeeProfiles).where(eq(employeeProfiles.id, created.employeeId));
    const recipientNotifications = database.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.tenantId, identity.tenantId), eq(notifications.recipientUserId, created.userId)));
    await database.delete(notificationDeliveries).where(and(eq(notificationDeliveries.tenantId, identity.tenantId), inArray(notificationDeliveries.notificationId, recipientNotifications)));
    await database.delete(notifications).where(and(eq(notifications.tenantId, identity.tenantId), eq(notifications.recipientUserId, created.userId)));
    await database.delete(tenantMemberships).where(and(eq(tenantMemberships.tenantId, identity.tenantId), eq(tenantMemberships.userId, created.userId)));
    await database.delete(users).where(eq(users.id, created.userId));
  }
});

test("tenant employee administration cannot mutate a shared multi-firm identity", async () => {
  const database = getDatabase();
  const identity = await findLoginIdentity(database, "loukesh@example.invalid", "sharma-kumar-ca");
  assert.ok(identity);
  const suffix = randomUUID().slice(0, 8);
  const created = await createEmployee(database, identity.tenantId, identity.userId, {
    designation: "Shared Associate",
    email: `shared-${suffix}@example.invalid`,
    fullName: `Shared ${suffix}`,
    joiningDate: "2026-08-16",
    mobileNumber: "",
    notes: "Cross-firm identity guard test",
    roleKey: "associate",
  });
  const secondTenantId = randomUUID();
  const secondMembershipId = randomUUID();
  await database.insert(tenants).values({ id: secondTenantId, legalName: `Second firm ${suffix}`, displayName: `Second firm ${suffix}`, slug: `second-${suffix}` });
  await database.insert(tenantMemberships).values({ id: secondMembershipId, tenantId: secondTenantId, userId: created.userId, roleKey: "associate", status: "active" });
  try {
    const input = { designation: "Changed", email: `shared-${suffix}@example.invalid`, fullName: `Changed ${suffix}`, joiningDate: "2026-08-16", mobileNumber: "", notes: "", roleKey: "associate" as const };
    await assert.rejects(() => updateEmployee(database, identity.tenantId, identity.userId, created.employeeId, input), (error: unknown) => error instanceof TeamRepositoryError && error.code === "shared_identity");
    await assert.rejects(() => provisionEmployeeAccess(database, identity.tenantId, identity.userId, created.employeeId), (error: unknown) => error instanceof TeamRepositoryError && error.code === "shared_identity");
  } finally {
    await database.delete(tenantMemberships).where(eq(tenantMemberships.id, secondMembershipId));
    await database.delete(tenants).where(eq(tenants.id, secondTenantId));
    await database.delete(auditEvents).where(eq(auditEvents.resourceId, created.employeeId));
    await database.delete(employeeWorkProfiles).where(and(eq(employeeWorkProfiles.tenantId, identity.tenantId), eq(employeeWorkProfiles.employeeUserId, created.userId)));
    await database.delete(employeeProfiles).where(eq(employeeProfiles.id, created.employeeId));
    await database.delete(tenantMemberships).where(and(eq(tenantMemberships.tenantId, identity.tenantId), eq(tenantMemberships.userId, created.userId)));
    await database.delete(users).where(eq(users.id, created.userId));
  }
});

test("office tasks enforce tenant context, employee ownership, and atomic completion", async () => {
  const database = getDatabase();
  const identity = await findLoginIdentity(database, "loukesh@example.invalid", "sharma-kumar-ca");
  assert.ok(identity);
  const assigneeId = "20000000-0000-4000-8000-000000000005";
  const reviewerId = "20000000-0000-4000-8000-000000000002";
  const workItemId = "60000000-0000-4000-8000-000000000002";
  const legalEntityId = "40000000-0000-4000-8000-000000000001";

  await assert.rejects(
    () => createOfficeTask(database, identity.tenantId, identity.userId, {
      assigneeId,
      blockerNote: "",
      estimateMinutes: null,
      description: "Prepare the reconciliation working papers.",
      dueDate: "2026-08-25",
      legalEntityId: "40000000-0000-4000-8000-000000000002",
      priority: "high",
      reviewerId,
      status: "todo",
      title: "Prepare reconciliation",
      workItemId,
    }),
    (error: unknown) => error instanceof TaskRepositoryError && error.code === "context_mismatch",
  );

  const taskId = await createOfficeTask(database, identity.tenantId, identity.userId, {
    assigneeId,
    blockerNote: "",
    estimateMinutes: null,
    description: "Prepare the reconciliation working papers.",
    dueDate: "2026-08-25",
    legalEntityId,
    priority: "high",
    reviewerId,
    status: "todo",
    title: "Prepare reconciliation",
    workItemId,
  });

  try {
    assert.equal((await listTaskWorkspace(database, identity.tenantId, assigneeId, "associate")).tasks.some((item) => item.id === taskId), true);
    assert.equal((await listTaskWorkspace(database, identity.tenantId, identity.userId, "associate")).tasks.some((item) => item.id === taskId), false);
    assert.equal((await listTaskWorkspace(database, FOREIGN_TENANT_ID, assigneeId, "associate")).tasks.length, 0);
    assert.equal((await getTask360(database, identity.tenantId, assigneeId, "associate", taskId))?.legalEntityId, legalEntityId);
    assert.equal(await getTask360(database, identity.tenantId, identity.userId, "associate", taskId), null);

    await assert.rejects(() => updateOfficeTask(database, identity.tenantId, identity.userId, taskId, {
      assigneeId,
      blockerNote: "",
      estimateMinutes: null,
      description: "Attempted manager-owned status change.",
      dueDate: "2026-08-25",
      legalEntityId,
      priority: "high",
      reviewerId,
      status: "in_progress",
      title: "Prepare reconciliation",
      workItemId,
    }), (error: unknown) => error instanceof TaskRepositoryError && error.code === "invalid_state");

    await updateOwnTaskStatus(database, identity.tenantId, assigneeId, taskId, {
      blockerNote: "Client confirmation awaited",
      status: "waiting",
    });
    assert.equal((await getTask360(database, identity.tenantId, identity.userId, "firm_administrator", taskId))?.status, "waiting");

    const completions = await Promise.allSettled([
      completeOfficeTask(database, identity.tenantId, identity.userId, taskId),
      completeOfficeTask(database, identity.tenantId, identity.userId, taskId),
    ]);
    assert.equal(completions.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal((await getTask360(database, identity.tenantId, identity.userId, "firm_administrator", taskId))?.status, "completed");
    const actions = await database.select({ action: auditEvents.action }).from(auditEvents).where(eq(auditEvents.resourceId, taskId));
    assert.deepEqual(actions.map((row) => row.action).sort(), ["task.completed", "task.created", "task.status_updated"]);
  } finally {
    await database.delete(auditEvents).where(eq(auditEvents.resourceId, taskId));
    await database.delete(officeTasks).where(eq(officeTasks.id, taskId));
  }
});

test("personal to-dos remain private to their owner through the complete lifecycle", async () => {
  const database = getDatabase();
  const identity = await findLoginIdentity(database, "loukesh@example.invalid", "sharma-kumar-ca");
  assert.ok(identity);
  const [otherMember] = await database.select({ userId: tenantMemberships.userId }).from(tenantMemberships).where(and(
    eq(tenantMemberships.tenantId, identity.tenantId),
    ne(tenantMemberships.userId, identity.userId),
    eq(tenantMemberships.status, "active"),
  )).limit(1);
  assert.ok(otherMember);

  const todoId = await createTodo(database, identity.tenantId, identity.userId, {
    recurrenceRule: null, recurrenceInterval: null,
    title: "File the personal follow-up",
    notes: "Keep this reminder private to its owner.",
    dueDate: "2026-08-16",
    dueTime: "17:30",
    priority: "high",
    category: "Compliance",
  });

  try {
    const workspace = await listTodoWorkspace(database, identity.tenantId, identity.userId, "2026-08-16");
    assert.equal(workspace.todos.some((todo) => todo.id === todoId), true);
    assert.equal(workspace.metrics.dueToday, 1);
    assert.equal(await getTodo(database, identity.tenantId, otherMember.userId, todoId), null);
    assert.equal((await listTodoWorkspace(database, identity.tenantId, otherMember.userId, "2026-08-16")).todos.some((todo) => todo.id === todoId), false);
    await assert.rejects(
      () => updateTodo(database, identity.tenantId, otherMember.userId, todoId, {
        recurrenceRule: null, recurrenceInterval: null,
        title: "Unauthorized edit",
        notes: "",
        dueDate: null,
        dueTime: null,
        priority: "normal",
        category: "",
      }),
      (error: unknown) => error instanceof TodoRepositoryError && error.code === "not_found",
    );

    await updateTodo(database, identity.tenantId, identity.userId, todoId, {
      recurrenceRule: null, recurrenceInterval: null,
      title: "File the personal follow-up today",
      notes: "Owner-updated reminder.",
      dueDate: "2026-08-17",
      dueTime: "09:15",
      priority: "urgent",
      category: "Filing",
    });
    assert.equal((await getTodo(database, identity.tenantId, identity.userId, todoId))?.priority, "urgent");

    await completeTodo(database, identity.tenantId, identity.userId, todoId);
    assert.equal((await getTodo(database, identity.tenantId, identity.userId, todoId))?.status, "completed");
    await reopenTodo(database, identity.tenantId, identity.userId, todoId);
    assert.equal((await getTodo(database, identity.tenantId, identity.userId, todoId))?.status, "open");
    await archiveTodo(database, identity.tenantId, identity.userId, todoId);
    const archived = await getTodo(database, identity.tenantId, identity.userId, todoId);
    assert.equal(archived?.status, "archived");
    assert.ok(archived?.archivedAt);
  } finally {
    await database.delete(personalTodos).where(eq(personalTodos.id, todoId));
  }
});

test("client lifecycle is tenant-scoped, audited, and archived without destructive deletion", async () => {
  const database = getDatabase();
  await seedDevelopmentData(database);
  const identity = await findLoginIdentity(database, "loukesh@example.invalid", "sharma-kumar-ca");
  assert.ok(identity);
  const suffix = randomUUID().slice(0, 8);
  const clientId = await createClient(database, identity.tenantId, identity.userId, {
    city: "Patna, Bihar",
    displayName: `Lifecycle ${suffix}`,
    entityType: "Private Company",
    gstRegistrations: 2,
    healthScore: 72,
    legalName: `Lifecycle ${suffix} Private Limited`,
    maskedPan: "AABCA••••F",
    ownerId: identity.userId,
    relationshipStart: "2026-08-16",
    riskStatus: "watch",
    services: ["GST", "BOOKS"],
  });
  let clientGroupId = "";
  let blockingWorkItemId = "";

  try {
    const created = await getClient360Data(database, identity.tenantId, clientId);
    assert.ok(created);
    clientGroupId = created.clientGroupId;
    assert.equal(created.gstRegistrations, 2);
    assert.deepEqual(created.services, ["BOOKS", "GST"]);
    assert.equal(await getClient360Data(database, FOREIGN_TENANT_ID, clientId), null);

    await updateClient(database, identity.tenantId, identity.userId, clientId, {
      city: "New Delhi",
      displayName: `Lifecycle ${suffix} Updated`,
      entityType: "Private Company",
      gstRegistrations: 1,
      healthScore: 91,
      legalName: `Lifecycle ${suffix} Private Limited`,
      maskedPan: "AABCA••••F",
      ownerId: identity.userId,
      relationshipStart: "2026-08-16",
      riskStatus: "healthy",
      services: ["GST", "AUDIT"],
    });
    const updated = await getClient360Data(database, identity.tenantId, clientId);
    assert.equal(updated?.displayName, `Lifecycle ${suffix} Updated`);
    assert.equal(updated?.healthScore, 91);
    assert.equal(updated?.gstRegistrations, 1);
    assert.deepEqual(updated?.services, ["AUDIT", "GST"]);

    blockingWorkItemId = await createWorkItem(database, identity.tenantId, identity.userId, {
      budgetMinutes: null,
      assigneeId: identity.userId,
      blockerNote: "",
      internalDueDate: "2026-08-30",
      legalEntityId: clientId,
      missingItemCount: 0,
      periodKey: `Archive guard ${suffix}`,
      progress: 10,
      reviewerId: null,
      serviceKey: "AUDIT",
      statutoryDueDate: "2026-08-31",
      status: "at_risk",
    });
    await assert.rejects(
      () => archiveClient(database, identity.tenantId, identity.userId, clientId),
      (error: unknown) => error instanceof ClientRepositoryError && error.code === "active_obligations",
    );
    await database.delete(auditEvents).where(eq(auditEvents.resourceId, blockingWorkItemId));
    await database.delete(workItems).where(eq(workItems.id, blockingWorkItemId));
    blockingWorkItemId = "";

    await archiveClient(database, identity.tenantId, identity.userId, clientId);
    assert.equal((await getClient360Data(database, identity.tenantId, clientId))?.status, "archived");
    const actions = await database.select({ action: auditEvents.action }).from(auditEvents).where(and(
      eq(auditEvents.tenantId, identity.tenantId),
      eq(auditEvents.resourceId, clientId),
    ));
    assert.deepEqual(actions.map((row) => row.action).sort(), ["client.archived", "client.created", "client.updated"]);
  } finally {
    if (blockingWorkItemId) {
      await database.delete(auditEvents).where(eq(auditEvents.resourceId, blockingWorkItemId));
      await database.delete(workItems).where(eq(workItems.id, blockingWorkItemId));
    }
    await database.delete(auditEvents).where(eq(auditEvents.resourceId, clientId));
    await database.delete(registrations).where(eq(registrations.legalEntityId, clientId));
    await database.delete(clientServices).where(eq(clientServices.legalEntityId, clientId));
    await database.delete(legalEntities).where(eq(legalEntities.id, clientId));
    if (clientGroupId) await database.delete(clientGroups).where(eq(clientGroups.id, clientGroupId));
  }
});

test("compliance work lifecycle is tenant-scoped, audited, and completed outside active queues", async () => {
  const database = getDatabase();
  await seedDevelopmentData(database);
  const identity = await findLoginIdentity(database, "loukesh@example.invalid", "sharma-kumar-ca");
  assert.ok(identity);
  const members = await listWorkMembers(database, identity.tenantId);
  const reviewer = members.find((member) => member.id !== identity.userId);
  assert.ok(reviewer);
  const suffix = randomUUID().slice(0, 8);
  const workItemId = await createWorkItem(database, identity.tenantId, identity.userId, {
      budgetMinutes: null,
    assigneeId: identity.userId,
    blockerNote: "",
    internalDueDate: "2026-08-19",
    legalEntityId: "40000000-0000-4000-8000-000000000001",
    missingItemCount: 0,
    periodKey: `Lifecycle ${suffix}`,
    progress: 20,
    reviewerId: reviewer.id,
    serviceKey: "gstr_3b",
    statutoryDueDate: "2026-08-20",
    status: "at_risk",
  });

  try {
    const created = await getWorkItem360(database, identity.tenantId, workItemId);
    assert.equal(created?.clientName, "Aarav Retail Pvt. Ltd.");
    assert.equal(created?.reviewerId, reviewer.id);
    assert.equal(await getWorkItem360(database, FOREIGN_TENANT_ID, workItemId), null);

    await updateWorkItem(database, identity.tenantId, identity.userId, workItemId, {
      budgetMinutes: null,
      assigneeId: identity.userId,
      blockerNote: "Signed statements awaited from client",
      internalDueDate: "2026-08-18",
      legalEntityId: "40000000-0000-4000-8000-000000000001",
      missingItemCount: 2,
      periodKey: `Lifecycle ${suffix}`,
      progress: 65,
      reviewerId: reviewer.id,
      serviceKey: "gstr_3b",
      statutoryDueDate: "2026-08-20",
      status: "waiting",
    });
    assert.equal((await getWorkItem360(database, identity.tenantId, workItemId))?.progress, 65);

    const completionResults = await Promise.allSettled([
      completeWorkItem(database, identity.tenantId, identity.userId, workItemId),
      completeWorkItem(database, identity.tenantId, identity.userId, workItemId),
    ]);
    assert.equal(completionResults.filter((result) => result.status === "fulfilled").length, 1);
    const completed = await getWorkItem360(database, identity.tenantId, workItemId);
    assert.equal(completed?.status, "completed");
    assert.equal(completed?.progress, 100);
    assert.equal(completed?.missingItemCount, 0);
    const dashboard = mapDashboardRecords(await loadDashboardRecords(database, identity.tenantId), new Date("2026-08-16T09:00:00+05:30"), "postgres");
    assert.equal(dashboard.work.some((item) => item.id === workItemId), false);
    assert.ok(dashboard.metrics.completed >= 1);

    const actions = await database.select({ action: auditEvents.action }).from(auditEvents).where(and(
      eq(auditEvents.tenantId, identity.tenantId),
      eq(auditEvents.resourceId, workItemId),
    ));
    assert.deepEqual(actions.map((row) => row.action).sort(), ["work.completed", "work.created", "work.updated"]);
  } finally {
    await database.delete(auditEvents).where(eq(auditEvents.resourceId, workItemId));
    await database.delete(workItems).where(eq(workItems.id, workItemId));
  }
});

test("document request and upload lifecycle is tenant-scoped, audited, and stateful", async () => {
  const database = getDatabase();
  await seedDevelopmentData(database);
  const identity = await findLoginIdentity(database, "loukesh@example.invalid", "sharma-kumar-ca");
  assert.ok(identity);
  const legalEntityId = "40000000-0000-4000-8000-000000000001";
  const suffix = randomUUID().slice(0, 8);
  const requestId = await createDocumentRequest(database, identity.tenantId, identity.userId, {
    description: "Signed copy", dueDate: "2026-08-31", legalEntityId, title: `Statements ${suffix}`, workItemId: null,
  });
  const cancelledRequestId = await createDocumentRequest(database, identity.tenantId, identity.userId, {
    description: "", dueDate: "2026-09-02", legalEntityId, title: `Cancelled ${suffix}`, workItemId: null,
  });
  let documentId = "";
  try {
    assert.equal((await listDocumentWorkspace(database, FOREIGN_TENANT_ID)).requests.some((item) => item.id === requestId), false);
    const uploadResults = await Promise.allSettled(Array.from({ length: 2 }, () => recordDocumentUpload(database, identity.tenantId, identity.userId, {
      legalEntityId, workItemId: null, requestId, originalName: "statements.pdf", storageName: randomUUID(),
      mimeType: "application/pdf", sizeBytes: 128, sha256: "a".repeat(64),
    })));
    const successfulUploads = uploadResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    assert.equal(successfulUploads.length, 1);
    documentId = successfulUploads[0];
    await cancelDocumentRequest(database, identity.tenantId, identity.userId, cancelledRequestId);
    const workspace = await listDocumentWorkspace(database, identity.tenantId);
    assert.equal(workspace.requests.find((item) => item.id === requestId)?.status, "received");
    assert.equal(workspace.requests.find((item) => item.id === cancelledRequestId)?.status, "cancelled");
    assert.equal(workspace.documents.find((item) => item.id === documentId)?.requestTitle, `Statements ${suffix}`);
    assert.equal(await getDocumentMetadata(database, FOREIGN_TENANT_ID, documentId), null);
    const requestActions = await database.select({ action: auditEvents.action }).from(auditEvents).where(and(
      eq(auditEvents.tenantId, identity.tenantId), eq(auditEvents.resourceId, requestId),
    ));
    assert.deepEqual(requestActions.map((row) => row.action).sort(), ["document_request.created", "document_request.received"]);
  } finally {
    if (documentId) {
      await database.delete(auditEvents).where(eq(auditEvents.resourceId, documentId));
      await database.delete(documents).where(eq(documents.id, documentId));
    }
    await database.delete(auditEvents).where(eq(auditEvents.resourceId, requestId));
    await database.delete(auditEvents).where(eq(auditEvents.resourceId, cancelledRequestId));
    await database.delete(documentRequests).where(eq(documentRequests.id, requestId));
    await database.delete(documentRequests).where(eq(documentRequests.id, cancelledRequestId));
  }
});

test("recurrence generates entitled work items once per period and audits the creation", async () => {
  const database = getDatabase();
  const identity = await findLoginIdentity(database, "loukesh@example.invalid", "sharma-kumar-ca");
  assert.ok(identity);
  const suffix = randomUUID().slice(0, 8).toUpperCase().replaceAll(/[^A-Z0-9]/g, "X");
  const [entity] = await database.select({ id: legalEntities.id }).from(legalEntities).where(and(
    eq(legalEntities.tenantId, identity.tenantId), eq(legalEntities.status, "active"),
  )).limit(1);
  assert.ok(entity);
  const [gstService] = await database.select({ id: serviceCatalog.id }).from(serviceCatalog).where(and(
    eq(serviceCatalog.tenantId, identity.tenantId), eq(serviceCatalog.code, "GST"),
  )).limit(1);
  assert.ok(gstService);
  let packageId = "";
  let assignmentId = "";
  const generatedIds: string[] = [];
  const previousServices = await database.select({ serviceKey: clientServices.serviceKey, status: clientServices.status }).from(clientServices).where(and(
    eq(clientServices.tenantId, identity.tenantId), eq(clientServices.legalEntityId, entity.id),
  ));
  try {
    packageId = await createPackage(database, identity.tenantId, identity.userId, {
      billingCycle: "monthly",
      code: `RECUR${suffix}`,
      description: "Recurrence integration package.",
      name: `Recurrence ${suffix}`,
      serviceIds: [gstService.id],
      standardFeePaise: 250000,
      status: "active",
    });
    assignmentId = await assignClientPackage(database, identity.tenantId, identity.userId, {
      addonServiceIds: [],
      agreedFeePaise: 250000,
      effectiveFrom: "2026-04-01",
      effectiveTo: null,
      legalEntityId: entity.id,
      packageId,
      replaceExisting: false,
    });
    const firstRun = await generateRecurringWorkItems(database, identity.tenantId);
    assert.ok(firstRun > 0);
    const generated = await database.select({ id: workItems.id, periodKey: workItems.periodKey, status: workItems.status }).from(workItems).where(and(
      eq(workItems.tenantId, identity.tenantId), eq(workItems.legalEntityId, entity.id), eq(workItems.serviceKey, "GST"),
    ));
    assert.ok(generated.length > 0);
    generatedIds.push(...generated.map((row) => row.id));
    assert.ok(generated.every((row) => row.status === "waiting"));
    const secondRun = await generateRecurringWorkItems(database, identity.tenantId);
    assert.equal(secondRun, 0);
    const [audit] = await database.select({ action: auditEvents.action }).from(auditEvents).where(and(
      eq(auditEvents.tenantId, identity.tenantId), eq(auditEvents.resourceId, generatedIds[0]),
    ));
    assert.equal(audit?.action, "work_item.auto_generated");
  } finally {
    for (const workItemId of generatedIds) {
      await database.delete(auditEvents).where(eq(auditEvents.resourceId, workItemId));
      await database.delete(workItems).where(eq(workItems.id, workItemId));
    }
    if (assignmentId) {
      await database.delete(auditEvents).where(eq(auditEvents.resourceId, assignmentId));
      await database.delete(clientPackageAssignmentServices).where(eq(clientPackageAssignmentServices.assignmentId, assignmentId));
      await database.delete(clientPackageAssignments).where(eq(clientPackageAssignments.id, assignmentId));
    }
    if (packageId) {
      await database.delete(auditEvents).where(eq(auditEvents.resourceId, packageId));
      await database.delete(servicePackageItems).where(eq(servicePackageItems.packageId, packageId));
      await database.delete(servicePackages).where(eq(servicePackages.id, packageId));
    }
    await database.delete(clientServices).where(and(eq(clientServices.tenantId, identity.tenantId), eq(clientServices.legalEntityId, entity.id)));
    if (previousServices.length) {
      await database.insert(clientServices).values(previousServices.map((service) => ({ tenantId: identity.tenantId, legalEntityId: entity.id, serviceKey: service.serviceKey, status: service.status })));
    }
  }
});

test("invoice lifecycle is tenant-scoped, sequenced, audited, and feeds overdue notifications", async () => {
  const database = getDatabase();
  const identity = await findLoginIdentity(database, "loukesh@example.invalid", "sharma-kumar-ca");
  assert.ok(identity);
  const [entity] = await database.select({ id: legalEntities.id }).from(legalEntities).where(and(
    eq(legalEntities.tenantId, identity.tenantId), eq(legalEntities.status, "active"),
  )).limit(1);
  assert.ok(entity);
  let invoiceId = "";
  try {
    invoiceId = await createInvoice(database, identity.tenantId, identity.userId, {
      legalEntityId: entity.id,
      assignmentId: null,
      periodLabel: "August 2026",
      notes: "Integration lifecycle invoice.",
      taxPaise: 450000,
      lines: [
        { lineType: "package_fee", description: "GST compliance retainer", amountPaise: 2500000 },
        { lineType: "adjustment", description: "Onboarding discount", amountPaise: 0 },
      ],
    });
    const draft = await getInvoiceDetail(database, identity.tenantId, invoiceId);
    assert.equal(draft?.status, "draft");
    assert.equal(draft?.totalPaise, 2950000);
    assert.equal(draft?.lines.length, 2);
    assert.match(draft?.invoiceNumber ?? "", /^INV-\d{5}$/);
    assert.equal(await getInvoiceDetail(database, FOREIGN_TENANT_ID, invoiceId), null);

    await assert.rejects(
      () => recordInvoicePayment(database, identity.tenantId, identity.userId, invoiceId, "early"),
      (error: unknown) => error instanceof BillingRepositoryError && error.code === "invalid_state",
    );
    await issueInvoice(database, identity.tenantId, identity.userId, invoiceId, { issueDate: "2026-08-01", dueDate: "2026-08-10" });
    const generated = await generateDeadlineNotifications(database, identity.tenantId);
    assert.ok(generated >= 1);
    const [overdueNotification] = await database.select({ id: notifications.id, type: notifications.type }).from(notifications).where(and(
      eq(notifications.tenantId, identity.tenantId), eq(notifications.resourceId, invoiceId),
    ));
    assert.equal(overdueNotification?.type, "invoice_overdue");

    await recordInvoicePayment(database, identity.tenantId, identity.userId, invoiceId, "UTR-12345");
    const paid = await getInvoiceDetail(database, identity.tenantId, invoiceId);
    assert.equal(paid?.status, "paid");
    await assert.rejects(
      () => cancelInvoice(database, identity.tenantId, identity.userId, invoiceId, "too late"),
      (error: unknown) => error instanceof BillingRepositoryError && error.code === "invalid_state",
    );
    const actions = await database.select({ action: auditEvents.action }).from(auditEvents).where(and(
      eq(auditEvents.tenantId, identity.tenantId), eq(auditEvents.resourceId, invoiceId),
    ));
    assert.deepEqual(actions.map((row) => row.action).sort(), ["invoice.created", "invoice.issued", "invoice.paid"]);
  } finally {
    if (invoiceId) {
      const invoiceNotifications = database.select({ id: notifications.id }).from(notifications).where(and(
        eq(notifications.tenantId, identity.tenantId), eq(notifications.resourceId, invoiceId),
      ));
      await database.delete(notificationDeliveries).where(and(eq(notificationDeliveries.tenantId, identity.tenantId), inArray(notificationDeliveries.notificationId, invoiceNotifications)));
      await database.delete(notifications).where(and(eq(notifications.tenantId, identity.tenantId), eq(notifications.resourceId, invoiceId)));
      await database.delete(auditEvents).where(eq(auditEvents.resourceId, invoiceId));
      await database.delete(invoiceLines).where(and(eq(invoiceLines.tenantId, identity.tenantId), eq(invoiceLines.invoiceId, invoiceId)));
      await database.delete(invoices).where(eq(invoices.id, invoiceId));
    }
  }
});

test("client portal access is provisioned, entity-scoped, and cannot cross the staff session boundary", async () => {
  const database = getDatabase();
  const identity = await findLoginIdentity(database, "loukesh@example.invalid", "sharma-kumar-ca");
  assert.ok(identity);
  const clients = await database.select({ id: legalEntities.id }).from(legalEntities).where(and(
    eq(legalEntities.tenantId, identity.tenantId), eq(legalEntities.status, "active"),
  )).limit(2);
  assert.equal(clients.length, 2);
  const [entity, otherEntity] = clients;
  const suffix = randomUUID().slice(0, 8);
  const email = `portal-${suffix}@example.invalid`;
  let portalUserId = "";
  let requestId = "";
  try {
    const provisioned = await provisionPortalContact(database, identity.tenantId, identity.userId, {
      legalEntityId: entity.id, email, fullName: `Portal Contact ${suffix}`,
    });
    portalUserId = provisioned.portalUserId;
    assert.equal(provisioned.temporaryPassword.length, 20);

    const wrongFirm = await findPortalLoginIdentity(database, email, "not-a-firm");
    assert.equal(wrongFirm, null);
    const portalIdentity = await findPortalLoginIdentity(database, email, "sharma-kumar-ca");
    assert.ok(portalIdentity);
    assert.equal(portalIdentity.legalEntityId, entity.id);
    assert.ok(await verifyPassword(provisioned.temporaryPassword, portalIdentity.passwordHash));

    const portalToken = createSessionToken();
    await createPortalSessionRecord(database, {
      tenantId: identity.tenantId, portalUserId, tokenHash: hashSessionToken(portalToken),
      expiresAt: new Date(Date.now() + 60_000),
    });
    const portalSession = await findPortalSessionByTokenHash(database, hashSessionToken(portalToken));
    assert.ok(portalSession);
    assert.equal(portalSession.legalEntityId, entity.id);
    assert.equal(portalSession.mustChangePassword, true);

    assert.equal(await findSessionByTokenHash(database, hashSessionToken(portalToken)), null, "a portal token must never open a staff session");
    const staffToken = createSessionToken();
    await createSessionRecord(database, { membershipId: identity.membershipId, tokenHash: hashSessionToken(staffToken), expiresAt: new Date(Date.now() + 60_000) });
    try {
      assert.equal(await findPortalSessionByTokenHash(database, hashSessionToken(staffToken)), null, "a staff token must never open a portal session");
    } finally {
      await revokeSessionByTokenHash(database, hashSessionToken(staffToken));
      await database.delete(userSessions).where(eq(userSessions.tokenHash, hashSessionToken(staffToken)));
    }

    requestId = await createDocumentRequest(database, identity.tenantId, identity.userId, {
      description: "Portal scope check", dueDate: "2026-09-30", legalEntityId: otherEntity.id,
      title: `Other entity request ${suffix}`, workItemId: null,
    });
    const overview = await getPortalOverview(database, identity.tenantId, entity.id);
    assert.ok(!overview.requests.some((request) => request.id === requestId), "the portal must never expose another client's requests");
    assert.equal(await getPortalDocumentRequest(database, identity.tenantId, entity.id, requestId), null);

    await disablePortalContact(database, identity.tenantId, identity.userId, portalUserId);
    assert.equal(await findPortalSessionByTokenHash(database, hashSessionToken(portalToken)), null, "disabling a contact must end live portal sessions");
    assert.equal(await findPortalLoginIdentity(database, email, "sharma-kumar-ca"), null);
  } finally {
    if (requestId) {
      await database.delete(auditEvents).where(eq(auditEvents.resourceId, requestId));
      await database.delete(documentRequests).where(eq(documentRequests.id, requestId));
    }
    if (portalUserId) {
      await database.delete(auditEvents).where(eq(auditEvents.resourceId, portalUserId));
      await database.delete(clientPortalSessions).where(eq(clientPortalSessions.portalUserId, portalUserId));
      await database.delete(clientPortalCredentials).where(eq(clientPortalCredentials.portalUserId, portalUserId));
      await database.delete(clientPortalUsers).where(eq(clientPortalUsers.id, portalUserId));
    }
  }
});

test("filing acknowledgements are unique per firm and Tally export balances every voucher", async () => {
  const database = getDatabase();
  const identity = await findLoginIdentity(database, "loukesh@example.invalid", "sharma-kumar-ca");
  assert.ok(identity);
  const [item] = await database.select({ id: workItems.id, legalEntityId: workItems.legalEntityId }).from(workItems)
    .where(eq(workItems.tenantId, identity.tenantId)).limit(1);
  assert.ok(item);
  const suffix = randomUUID().slice(0, 8).toUpperCase().replaceAll(/[^A-Z0-9]/g, "X");
  const reference = `AA${suffix}0001`;
  let acknowledgementId = "";
  let invoiceId = "";
  try {
    acknowledgementId = await recordFilingAcknowledgement(database, identity.tenantId, identity.userId, {
      legalEntityId: item.legalEntityId, workItemId: item.id, portal: "gstn", filingType: "GSTR-3B",
      periodKey: "July 2026", acknowledgementNumber: reference, filedOn: "2026-08-19", portalStatus: "filed", remarks: "",
    });
    const recorded = await listFilingAcknowledgements(database, identity.tenantId, { workItemId: item.id });
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].acknowledgementNumber, reference);
    assert.equal(recorded[0].source, "manual");
    assert.equal((await listFilingAcknowledgements(database, FOREIGN_TENANT_ID, { workItemId: item.id })).length, 0);

    await assert.rejects(
      () => recordFilingAcknowledgement(database, identity.tenantId, identity.userId, {
        legalEntityId: item.legalEntityId, workItemId: item.id, portal: "gstn", filingType: "GSTR-3B",
        periodKey: "July 2026", acknowledgementNumber: reference, filedOn: "2026-08-19", portalStatus: "filed", remarks: "",
      }),
      (error: unknown) => error instanceof FilingRepositoryError && error.code === "duplicate",
    );

    const ledgers = await loadTallyLedgerExport(database, identity.tenantId);
    assert.ok(ledgers.length > 0);
    const ledgerXml = buildTallyLedgerXml(ledgers);
    assert.ok(ledgerXml.includes("<REPORTNAME>All Masters</REPORTNAME>"));

    invoiceId = await createInvoice(database, identity.tenantId, identity.userId, {
      legalEntityId: item.legalEntityId, assignmentId: null, periodLabel: "August 2026",
      notes: "", taxPaise: 180000, lines: [{ lineType: "package_fee", description: "Retainer", amountPaise: 1000000 }],
    });
    await issueInvoice(database, identity.tenantId, identity.userId, invoiceId, { issueDate: "2026-08-15", dueDate: "2026-08-30" });
    const vouchers = await loadTallyInvoiceExport(database, identity.tenantId, { from: "2026-08-01", to: "2026-08-31" });
    const exported = vouchers.find((voucher) => voucher.totalPaise === 1180000);
    assert.ok(exported, "the issued invoice must appear in the Tally export");
    assert.ok(voucherBalances(exported), "every exported voucher must balance");
    assert.ok(buildTallySalesVoucherXml(vouchers).includes("<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>"));

    const drafts = await loadTallyInvoiceExport(database, identity.tenantId, { from: "2020-01-01", to: "2020-12-31" });
    assert.equal(drafts.length, 0, "invoices outside the range are excluded");
  } finally {
    if (invoiceId) {
      await database.delete(auditEvents).where(eq(auditEvents.resourceId, invoiceId));
      await database.delete(invoiceLines).where(and(eq(invoiceLines.tenantId, identity.tenantId), eq(invoiceLines.invoiceId, invoiceId)));
      await database.delete(invoices).where(eq(invoices.id, invoiceId));
    }
    if (acknowledgementId) {
      await database.delete(auditEvents).where(eq(auditEvents.resourceId, acknowledgementId));
      await database.delete(filingAcknowledgements).where(eq(filingAcknowledgements.id, acknowledgementId));
    }
  }
});

test("statutory rate versions resolve by effective date and drive payroll suggestions", async () => {
  const database = getDatabase();
  const identity = await findLoginIdentity(database, "loukesh@example.invalid", "sharma-kumar-ca");
  assert.ok(identity);

  const seeded = await suggestStatutoryDeductions(database, identity.tenantId, {
    monthlyWagesPaise: 1_200_000, asOfDateKey: "2026-08-31", jurisdiction: "BR",
  });
  assert.deepEqual(seeded.missing, [], "the seed must configure EPF, ESI, and professional tax");
  assert.equal(seeded.suggestion.employeeProvidentFundPaise, 144_000);
  assert.equal(seeded.suggestion.esiApplicable, true);
  assert.equal(seeded.versions.length, 3);
  assert.ok(seeded.versions.every((version) => version.sourceReference.includes("Firm-reviewable")));

  const beforeAnyRule = await suggestStatutoryDeductions(database, identity.tenantId, {
    monthlyWagesPaise: 1_200_000, asOfDateKey: "2020-01-01", jurisdiction: "BR",
  });
  assert.equal(beforeAnyRule.missing.length, 3, "a period before the first version reports missing rules, not zero");
  assert.equal(beforeAnyRule.suggestion.employeeProvidentFundPaise, 0);

  const unknownState = await suggestStatutoryDeductions(database, identity.tenantId, {
    monthlyWagesPaise: 1_200_000, asOfDateKey: "2026-08-31", jurisdiction: "ZZ",
  });
  assert.deepEqual(unknownState.missing, ["professional_tax"], "an unconfigured state reports professional tax as missing");
  assert.equal(unknownState.suggestion.employeeProvidentFundPaise, 144_000, "national rules still resolve");

  let supersedingId = "";
  try {
    supersedingId = randomUUID();
    await database.insert(statutoryRateVersions).values({
      id: supersedingId, tenantId: identity.tenantId, ruleType: "epf", jurisdiction: "IN",
      effectiveFrom: "2026-07-01", status: "active", sourceReference: "Integration supersession check",
    });
    await database.insert(statutoryRateParameters).values([
      { tenantId: identity.tenantId, versionId: supersedingId, parameterKey: "employee_rate_bp", numericValue: 1000, unit: "basis_points" },
      { tenantId: identity.tenantId, versionId: supersedingId, parameterKey: "employer_rate_bp", numericValue: 1000, unit: "basis_points" },
      { tenantId: identity.tenantId, versionId: supersedingId, parameterKey: "pension_rate_bp", numericValue: 833, unit: "basis_points" },
      { tenantId: identity.tenantId, versionId: supersedingId, parameterKey: "wage_ceiling_paise", numericValue: 1_500_000, unit: "paise" },
    ]);

    const after = await suggestStatutoryDeductions(database, identity.tenantId, {
      monthlyWagesPaise: 1_200_000, asOfDateKey: "2026-08-31", jurisdiction: "BR",
    });
    assert.equal(after.suggestion.employeeProvidentFundPaise, 120_000, "the newer version applies from its effective date");

    const historic = await suggestStatutoryDeductions(database, identity.tenantId, {
      monthlyWagesPaise: 1_200_000, asOfDateKey: "2026-05-31", jurisdiction: "BR",
    });
    assert.equal(historic.suggestion.employeeProvidentFundPaise, 144_000, "an earlier period still recomputes with the rules then in force");

    assert.equal(await resolveRateVersion(database, FOREIGN_TENANT_ID, "epf", "IN", "2026-08-31"), null);
  } finally {
    if (supersedingId) {
      await database.delete(statutoryRateParameters).where(eq(statutoryRateParameters.versionId, supersedingId));
      await database.delete(statutoryRateVersions).where(eq(statutoryRateVersions.id, supersedingId));
    }
  }
});

test("disbursement files require an approved run and exclude held or unbanked employees", async () => {
  const database = getDatabase();
  const identity = await findLoginIdentity(database, "loukesh@example.invalid", "sharma-kumar-ca");
  assert.ok(identity);
  const [run] = await database.select({ id: payrollRuns.id, status: payrollRuns.status }).from(payrollRuns)
    .where(eq(payrollRuns.tenantId, identity.tenantId)).limit(1);
  if (!run) return;

  await assert.rejects(
    () => prepareDisbursement(database, identity.tenantId, randomUUID()),
    (error: unknown) => error instanceof DisbursementError && error.code === "not_found",
  );

  const entries = await database.select({ employeeUserId: payrollEntries.employeeUserId }).from(payrollEntries)
    .where(and(eq(payrollEntries.tenantId, identity.tenantId), eq(payrollEntries.payrollRunId, run.id)));
  if (entries.length === 0) return;

  let accountId = "";
  try {
    accountId = await replaceBankAccount(database, identity.tenantId, identity.userId, {
      employeeUserId: entries[0].employeeUserId,
      accountHolderName: "Integration Payee",
      accountNumber: "90010012345",
      ifscCode: "SBIN0009999",
      bankName: "State Bank of India",
      accountType: "savings",
    });

    const view = await getActiveBankAccount(database, identity.tenantId, entries[0].employeeUserId);
    assert.ok(view);
    assert.equal(view.maskedAccountNumber, "*******2345", "the account number must never be returned in full");
    assert.ok(!JSON.stringify(view).includes("90010012345"));

    const [auditRow] = await database.select({ reason: auditEvents.reason }).from(auditEvents).where(and(
      eq(auditEvents.tenantId, identity.tenantId), eq(auditEvents.resourceId, accountId),
    ));
    assert.ok(auditRow);
    assert.ok(!(auditRow.reason ?? "").includes("90010012345"), "the audit trail must never record the account number");

    if (run.status === "draft") {
      await assert.rejects(
        () => prepareDisbursement(database, identity.tenantId, run.id),
        (error: unknown) => error instanceof DisbursementError && error.code === "invalid_state",
      );
    } else {
      const prepared = await prepareDisbursement(database, identity.tenantId, run.id);
      const banked = prepared.batch.instructions.length + prepared.batch.exclusions.length;
      assert.equal(banked, entries.length, "every entry is either an instruction or a stated exclusion");
      assert.equal(
        prepared.batch.totalAmountPaise,
        prepared.batch.instructions.reduce((sum, instruction) => sum + instruction.amountPaise, 0),
      );
    }

    assert.equal(await getActiveBankAccount(database, FOREIGN_TENANT_ID, entries[0].employeeUserId), null);
  } finally {
    if (accountId) {
      await database.delete(auditEvents).where(eq(auditEvents.resourceId, accountId));
      await database.delete(employeeBankAccounts).where(and(
        eq(employeeBankAccounts.tenantId, identity.tenantId), eq(employeeBankAccounts.employeeUserId, entries[0].employeeUserId),
      ));
    }
  }
});

test("work queue scopes are tenant-isolated and disjoint between assignee and reviewer", async () => {
  const database = getDatabase();
  await seedDevelopmentData(database);
  const identity = await findLoginIdentity(database, "loukesh@example.invalid", "sharma-kumar-ca");
  assert.ok(identity);
  const today = "2026-08-20";
  const firm = { ...DEFAULT_WORK_QUEUE_PARAMS, scope: "firm" as const };

  const rows = await listWorkQueue(database, identity.tenantId, identity.userId, firm, today);
  const foreign = await database.select({ id: workItems.id }).from(workItems).where(ne(workItems.tenantId, identity.tenantId));
  assert.deepEqual(
    rows.filter((row) => foreign.some((other) => other.id === row.id)),
    [],
    "no other tenant work item may appear in any scope, including the firm scope",
  );

  const members = await listWorkMembers(database, identity.tenantId);
  for (const member of members) {
    const mine = await listWorkQueue(database, identity.tenantId, member.id, { ...DEFAULT_WORK_QUEUE_PARAMS, scope: "mine" }, today);
    const reviewing = await listWorkQueue(database, identity.tenantId, member.id, { ...DEFAULT_WORK_QUEUE_PARAMS, scope: "reviewing" }, today);
    assert.ok(mine.every((row) => row.assigneeId === member.id), `${member.fullName} mine scope must only hold their assignments`);
    assert.ok(reviewing.every((row) => row.reviewerId === member.id), `${member.fullName} reviewing scope must only hold their reviews`);
    // The separation-of-duties check guarantees these cannot overlap.
    assert.deepEqual(mine.filter((row) => reviewing.some((other) => other.id === row.id)), []);
    const totals = await getQueueTotals(database, identity.tenantId, member.id, { ...DEFAULT_WORK_QUEUE_PARAMS, scope: "mine" }, today);
    assert.equal(totals.active, mine.length, "the headline count must describe the list beneath it");
  }
});

test("a work item budget is a snapshot that later service-standard edits never rewrite", async () => {
  const database = getDatabase();
  await seedDevelopmentData(database);
  const identity = await findLoginIdentity(database, "loukesh@example.invalid", "sharma-kumar-ca");
  assert.ok(identity);
  // The client and service must come from a real entitlement: creation refuses
  // a service outside the client's active package.
  const entitled = (await listWorkClients(database, identity.tenantId)).find((option) => option.services.length > 0);
  assert.ok(entitled, "the seed entitles at least one client to a service");
  const client = { id: entitled.id };
  const serviceCode = entitled.services[0]!.key;
  const catalogue = await listServiceManagementWorkspace(database, identity.tenantId);
  const audit = catalogue.services.find((service) => service.code.toUpperCase() === serviceCode.toUpperCase());
  assert.ok(audit, "the entitled service exists in the catalogue");
  const originalStandard = audit.standardMinutes;
  const suffix = randomUUID().slice(0, 8);
  const created: string[] = [];

  try {
    await updateService(database, identity.tenantId, identity.userId, audit.id, { ...audit, standardMinutes: 90 });
    const first = await createWorkItem(database, identity.tenantId, identity.userId, {
      assigneeId: identity.userId, blockerNote: "", budgetMinutes: null, internalDueDate: "2026-09-10",
      legalEntityId: client.id, missingItemCount: 0, periodKey: `Budget A ${suffix}`, progress: 0,
      reviewerId: null, serviceKey: serviceCode, statutoryDueDate: "2026-09-15", status: "at_risk",
    });
    created.push(first);
    assert.equal((await getWorkItem360(database, identity.tenantId, first))?.budgetMinutes, 90, "a new item copies the standard");

    await updateService(database, identity.tenantId, identity.userId, audit.id, { ...audit, standardMinutes: 150 });
    assert.equal(
      (await getWorkItem360(database, identity.tenantId, first))?.budgetMinutes,
      90,
      "the existing budget is a snapshot, not a live join",
    );

    const second = await createWorkItem(database, identity.tenantId, identity.userId, {
      assigneeId: identity.userId, blockerNote: "", budgetMinutes: null, internalDueDate: "2026-10-10",
      legalEntityId: client.id, missingItemCount: 0, periodKey: `Budget B ${suffix}`, progress: 0,
      reviewerId: null, serviceKey: serviceCode, statutoryDueDate: "2026-10-15", status: "at_risk",
    });
    created.push(second);
    assert.equal((await getWorkItem360(database, identity.tenantId, second))?.budgetMinutes, 150, "a later item picks up the new standard");
  } finally {
    await updateService(database, identity.tenantId, identity.userId, audit.id, { ...audit, standardMinutes: originalStandard });
    for (const id of created) {
      await database.delete(auditEvents).where(eq(auditEvents.resourceId, id));
      await database.delete(workItems).where(eq(workItems.id, id));
    }
  }
});

test("a bulk reassign applies the valid subset, reports the rest, and audits per item", async () => {
  const database = getDatabase();
  await seedDevelopmentData(database);
  const identity = await findLoginIdentity(database, "loukesh@example.invalid", "sharma-kumar-ca");
  assert.ok(identity);
  const entitled = (await listWorkClients(database, identity.tenantId)).find((option) => option.services.length > 0);
  assert.ok(entitled, "the seed entitles at least one client to a service");
  const client = { id: entitled.id };
  const serviceCode = entitled.services[0]!.key;
  const members = await listWorkMembers(database, identity.tenantId);
  const reviewer = members.find((member) => member.id !== identity.userId);
  assert.ok(reviewer, "the seed provides more than one active member");
  const suffix = randomUUID().slice(0, 8);
  const created: string[] = [];

  try {
    const reviewerHeld = await createWorkItem(database, identity.tenantId, identity.userId, {
      assigneeId: identity.userId, blockerNote: "", budgetMinutes: null, internalDueDate: "2026-09-10",
      legalEntityId: client.id, missingItemCount: 0, periodKey: `Bulk A ${suffix}`, progress: 0,
      reviewerId: reviewer.id, serviceKey: serviceCode, statutoryDueDate: "2026-09-15", status: "at_risk",
    });
    created.push(reviewerHeld);
    const plain = await createWorkItem(database, identity.tenantId, identity.userId, {
      assigneeId: identity.userId, blockerNote: "", budgetMinutes: null, internalDueDate: "2026-09-11",
      legalEntityId: client.id, missingItemCount: 0, periodKey: `Bulk B ${suffix}`, progress: 0,
      reviewerId: null, serviceKey: serviceCode, statutoryDueDate: "2026-09-16", status: "at_risk",
    });
    created.push(plain);

    const plan = await applyBulkWorkChange(database, identity.tenantId, identity.userId, [reviewerHeld, plain], { kind: "assignee", memberId: reviewer.id });
    assert.equal(plan.apply.length, 1);
    assert.equal(plan.apply[0]?.id, plain);
    assert.equal(plan.skip.length, 1);
    assert.equal(plan.skip[0]?.id, reviewerHeld);
    assert.match(plan.skip[0]!.reason, /already reviews/i);

    // The skipped item must be untouched, not partially written.
    assert.equal((await getWorkItem360(database, identity.tenantId, reviewerHeld))?.assigneeId, identity.userId);
    assert.equal((await getWorkItem360(database, identity.tenantId, plain))?.assigneeId, reviewer.id);

    const [applied] = await database.select({ value: count() }).from(auditEvents).where(and(
      eq(auditEvents.tenantId, identity.tenantId),
      eq(auditEvents.resourceId, plain),
      eq(auditEvents.action, "work.bulk.assignee"),
    ));
    assert.equal(applied?.value, 1, "one audit event per changed item, not one per batch");
    const [untouched] = await database.select({ value: count() }).from(auditEvents).where(and(
      eq(auditEvents.tenantId, identity.tenantId),
      eq(auditEvents.resourceId, reviewerHeld),
      eq(auditEvents.action, "work.bulk.assignee"),
    ));
    assert.equal(untouched?.value, 0, "a skipped item must not be audited as changed");
  } finally {
    for (const id of created) {
      await database.delete(auditEvents).where(eq(auditEvents.resourceId, id));
      await database.delete(workItems).where(eq(workItems.id, id));
    }
  }
});

test("capacity lanes derive availability from the configured shift", async () => {
  const database = getDatabase();
  await seedDevelopmentData(database);
  const identity = await findLoginIdentity(database, "loukesh@example.invalid", "sharma-kumar-ca");
  assert.ok(identity);
  const lanes = await getCapacityLanes(database, identity.tenantId, "2026-08-20");
  assert.ok(lanes.length > 0, "seeded employees hold attendance work profiles");
  for (const lane of lanes) {
    assert.equal(lane.weeks.length, 4, "the horizon is four weeks");
    // The seeded Bihar shift is 450 full-day minutes across a six-day mask.
    assert.equal(lane.availableMinutes, 2700);
    assert.deepEqual(lane.weeks.map((week) => week.weekStart), ["2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07"]);
    for (const week of lane.weeks) {
      assert.ok(week.loadMinutes >= 0);
      assert.ok(week.unbudgetedCount >= 0);
      assert.equal(week.availableMinutes, lane.availableMinutes);
    }
  }
});

test("task queue scopes are tenant-isolated and cannot be widened past the access floor", async () => {
  const database = getDatabase();
  await seedDevelopmentData(database);
  const identity = await findLoginIdentity(database, "loukesh@example.invalid", "sharma-kumar-ca");
  assert.ok(identity);
  const firm = { ...DEFAULT_TASK_QUEUE_PARAMS, scope: "firm" as const };

  const rows = await listTaskQueue(database, identity.tenantId, identity.userId, identity.roleKey, firm);
  const foreign = await database.select({ id: officeTasks.id }).from(officeTasks).where(ne(officeTasks.tenantId, identity.tenantId));
  assert.deepEqual(
    rows.filter((row) => foreign.some((other) => other.id === row.id)),
    [],
    "no other tenant task may appear in any scope",
  );

  // An associate asking for the firm scope through the query string must still
  // only receive their own assignments.
  const [associate] = await database.select({ userId: tenantMemberships.userId }).from(tenantMemberships).where(and(
    eq(tenantMemberships.tenantId, identity.tenantId), eq(tenantMemberships.roleKey, "associate"),
  )).limit(1);
  assert.ok(associate, "the seed provides an associate");
  const widened = await listTaskQueue(database, identity.tenantId, associate.userId, "associate", firm);
  assert.ok(
    widened.every((row) => row.assigneeId === associate.userId),
    "the access floor must hold against a hand-edited scope",
  );
});

test("task queue orders by deadline then urgency, and by urgency first on request", async () => {
  const database = getDatabase();
  await seedDevelopmentData(database);
  const identity = await findLoginIdentity(database, "loukesh@example.invalid", "sharma-kumar-ca");
  assert.ok(identity);
  const rank = { urgent: 0, high: 1, normal: 2, low: 3 } as Record<string, number>;

  const byDue = await listTaskQueue(database, identity.tenantId, identity.userId, identity.roleKey, { ...DEFAULT_TASK_QUEUE_PARAMS, scope: "firm" });
  for (let index = 1; index < byDue.length; index += 1) {
    const previous = byDue[index - 1]!;
    const current = byDue[index]!;
    assert.ok(previous.dueDate <= current.dueDate, "deadline order holds");
    // Ties inside a single day resolve by urgency, not by planner order.
    if (previous.dueDate === current.dueDate) assert.ok(rank[previous.priority]! <= rank[current.priority]!);
  }

  const byPriority = await listTaskQueue(database, identity.tenantId, identity.userId, identity.roleKey, { ...DEFAULT_TASK_QUEUE_PARAMS, scope: "firm", sort: "priority" });
  for (let index = 1; index < byPriority.length; index += 1) {
    assert.ok(rank[byPriority[index - 1]!.priority]! <= rank[byPriority[index]!.priority]!, "urgency leads");
  }
});

test("a bulk task reassign applies the valid subset, reports the rest, and audits per task", async () => {
  const database = getDatabase();
  await seedDevelopmentData(database);
  const identity = await findLoginIdentity(database, "loukesh@example.invalid", "sharma-kumar-ca");
  assert.ok(identity);
  const members = await listWorkMembers(database, identity.tenantId);
  const assignee = members.find((member) => member.id !== identity.userId);
  const reviewer = members.find((member) => member.id !== identity.userId && member.id !== assignee?.id);
  assert.ok(assignee && reviewer, "the seed provides several active members");
  const suffix = randomUUID().slice(0, 8);
  const created: string[] = [];

  try {
    const reviewerHeld = await createOfficeTask(database, identity.tenantId, identity.userId, {
      assigneeId: assignee.id, blockerNote: "", estimateMinutes: null, description: "Bulk guard",
      dueDate: "2026-09-15", legalEntityId: null, priority: "normal", reviewerId: reviewer.id,
      status: "todo", title: `Bulk A ${suffix}`, workItemId: null,
    });
    created.push(reviewerHeld);
    const plain = await createOfficeTask(database, identity.tenantId, identity.userId, {
      assigneeId: assignee.id, blockerNote: "", estimateMinutes: 90, description: "Bulk plain",
      dueDate: "2026-09-16", legalEntityId: null, priority: "normal", reviewerId: null,
      status: "todo", title: `Bulk B ${suffix}`, workItemId: null,
    });
    created.push(plain);

    const plan = await applyBulkTaskChange(database, identity.tenantId, identity.userId, [reviewerHeld, plain], { kind: "assignee", memberId: reviewer.id });
    assert.equal(plan.apply.length, 1);
    assert.equal(plan.apply[0]?.id, plain);
    assert.equal(plan.skip.length, 1);
    assert.equal(plan.skip[0]?.id, reviewerHeld);
    assert.match(plan.skip[0]!.reason, /already reviews/i);

    const after = await database.select({ assigneeId: officeTasks.assigneeId, id: officeTasks.id }).from(officeTasks).where(and(
      eq(officeTasks.tenantId, identity.tenantId), inArray(officeTasks.id, [reviewerHeld, plain]),
    ));
    assert.equal(after.find((task) => task.id === reviewerHeld)?.assigneeId, assignee.id, "a skipped task is untouched");
    assert.equal(after.find((task) => task.id === plain)?.assigneeId, reviewer.id);

    const [applied] = await database.select({ value: count() }).from(auditEvents).where(and(
      eq(auditEvents.tenantId, identity.tenantId),
      eq(auditEvents.resourceId, plain),
      eq(auditEvents.action, "task.bulk.assignee"),
    ));
    assert.equal(applied?.value, 1, "one audit event per changed task, not one per batch");
    const [untouched] = await database.select({ value: count() }).from(auditEvents).where(and(
      eq(auditEvents.tenantId, identity.tenantId),
      eq(auditEvents.resourceId, reviewerHeld),
      eq(auditEvents.action, "task.bulk.assignee"),
    ));
    assert.equal(untouched?.value, 0, "a skipped task must not be audited as changed");
  } finally {
    for (const id of created) {
      await database.delete(notificationDeliveries).where(inArray(notificationDeliveries.notificationId,
        database.select({ id: notifications.id }).from(notifications).where(eq(notifications.resourceId, id))));
      await database.delete(notifications).where(eq(notifications.resourceId, id));
      await database.delete(auditEvents).where(eq(auditEvents.resourceId, id));
      await database.delete(officeTasks).where(eq(officeTasks.id, id));
    }
  }
});

test("task capacity lanes derive availability from the configured shift", async () => {
  const database = getDatabase();
  await seedDevelopmentData(database);
  const identity = await findLoginIdentity(database, "loukesh@example.invalid", "sharma-kumar-ca");
  assert.ok(identity);
  const lanes = await getTaskCapacityLanes(database, identity.tenantId, "2026-08-21");
  assert.ok(lanes.length > 0, "seeded employees hold attendance work profiles");
  for (const lane of lanes) {
    assert.equal(lane.weeks.length, 4);
    // The seeded Bihar shift is 450 full-day minutes across a six-day mask.
    assert.equal(lane.availableMinutes, 2700);
    for (const week of lane.weeks) {
      assert.ok(week.loadMinutes >= 0);
      assert.ok(week.unestimatedCount >= 0);
    }
  }
});

test("a bulk to-do change cannot reach another person's private items", async () => {
  const database = getDatabase();
  await seedDevelopmentData(database);
  const identity = await findLoginIdentity(database, "loukesh@example.invalid", "sharma-kumar-ca");
  assert.ok(identity);
  const [other] = await database.select({ userId: tenantMemberships.userId }).from(tenantMemberships).where(and(
    eq(tenantMemberships.tenantId, identity.tenantId), ne(tenantMemberships.userId, identity.userId),
  )).limit(1);
  assert.ok(other, "the seed provides another member");
  const suffix = randomUUID().slice(0, 8);
  const created: string[] = [];

  try {
    const mine = await createTodo(database, identity.tenantId, identity.userId, {
      title: `Mine ${suffix}`, notes: "", dueDate: "2026-09-10", dueTime: null,
      priority: "normal", category: "Personal", recurrenceRule: null, recurrenceInterval: null,
    });
    created.push(mine);
    const theirs = await createTodo(database, identity.tenantId, other.userId, {
      title: `Theirs ${suffix}`, notes: "", dueDate: "2026-09-10", dueTime: null,
      priority: "normal", category: "Personal", recurrenceRule: null, recurrenceInterval: null,
    });
    created.push(theirs);

    // Passing someone else's id must change nothing, not merely be filtered later.
    const plan = await applyBulkTodoChange(database, identity.tenantId, identity.userId, [mine, theirs], { kind: "complete" });
    assert.equal(plan.apply.length, 1);
    assert.equal(plan.apply[0]?.id, mine);

    const [untouched] = await database.select({ status: personalTodos.status }).from(personalTodos).where(eq(personalTodos.id, theirs));
    assert.equal(untouched?.status, "open", "another owner's to-do must be untouched");

    // The same holds for a category rename.
    const renamed = await renameTodoCategory(database, identity.tenantId, identity.userId, "Personal", `Renamed ${suffix}`);
    assert.equal(renamed, 1, "only the caller's own rows are renamed");
    const [theirCategory] = await database.select({ category: personalTodos.category }).from(personalTodos).where(eq(personalTodos.id, theirs));
    assert.equal(theirCategory?.category, "Personal");

    // And for the load strip.
    const strip = await getTodoLoadStrip(database, identity.tenantId, identity.userId, "2026-09-10", 1);
    assert.equal(strip[0]?.count, 0, "a completed to-do leaves the strip, and another owner's never entered it");
  } finally {
    for (const id of created) await database.delete(personalTodos).where(eq(personalTodos.id, id));
  }
});

test("completing a repeating to-do schedules the next one and leaves the original complete", async () => {
  const database = getDatabase();
  await seedDevelopmentData(database);
  const identity = await findLoginIdentity(database, "loukesh@example.invalid", "sharma-kumar-ca");
  assert.ok(identity);
  const suffix = randomUUID().slice(0, 8);
  const title = `Repeat ${suffix}`;

  try {
    const first = await createTodo(database, identity.tenantId, identity.userId, {
      title, notes: "Weekly chase", dueDate: "2026-09-10", dueTime: "09:30",
      priority: "high", category: "Recurring", recurrenceRule: "week", recurrenceInterval: 1,
    });
    const nextId = await completeTodo(database, identity.tenantId, identity.userId, first);
    assert.ok(nextId, "completing a repeating to-do returns the new instance");

    const rows = await database.select({
      dueDate: personalTodos.dueDate, dueTime: personalTodos.dueTime, id: personalTodos.id,
      priority: personalTodos.priority, recurrenceInterval: personalTodos.recurrenceInterval,
      recurrenceRule: personalTodos.recurrenceRule, status: personalTodos.status,
    }).from(personalTodos).where(and(eq(personalTodos.tenantId, identity.tenantId), eq(personalTodos.title, title)));
    assert.equal(rows.length, 2, "the original stays, the next is added");
    const original = rows.find((row) => row.id === first);
    const next = rows.find((row) => row.id === nextId);
    assert.equal(original?.status, "completed");
    assert.equal(next?.status, "open");
    assert.equal(next?.dueDate, "2026-09-17", "one week on");
    assert.equal(next?.dueTime, "09:30", "time of day carries forward");
    assert.equal(next?.priority, "high");
    assert.equal(next?.recurrenceRule, "week", "the rule carries forward so the chain continues");
    assert.equal(next?.recurrenceInterval, 1);
  } finally {
    await database.delete(personalTodos).where(and(eq(personalTodos.tenantId, identity.tenantId), eq(personalTodos.title, title)));
  }
});

test("completing a non-repeating to-do creates nothing", async () => {
  const database = getDatabase();
  await seedDevelopmentData(database);
  const identity = await findLoginIdentity(database, "loukesh@example.invalid", "sharma-kumar-ca");
  assert.ok(identity);
  const title = `Once ${randomUUID().slice(0, 8)}`;
  try {
    const id = await createTodo(database, identity.tenantId, identity.userId, {
      title, notes: "", dueDate: "2026-09-10", dueTime: null,
      priority: "normal", category: "", recurrenceRule: null, recurrenceInterval: null,
    });
    assert.equal(await completeTodo(database, identity.tenantId, identity.userId, id), null);
    const [{ value }] = await database.select({ value: count() }).from(personalTodos).where(and(
      eq(personalTodos.tenantId, identity.tenantId), eq(personalTodos.title, title),
    ));
    assert.equal(value, 1, "no phantom follow-up");
  } finally {
    await database.delete(personalTodos).where(and(eq(personalTodos.tenantId, identity.tenantId), eq(personalTodos.title, title)));
  }
});
