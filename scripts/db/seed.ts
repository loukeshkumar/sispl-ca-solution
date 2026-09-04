import { and, count, eq } from "drizzle-orm";
import { pathToFileURL } from "node:url";

import {
  articleshipPolicies,
  procedureSteps,
  procedureVersions,
  cpePolicies,
  articleshipRegistrations,
  attendancePolicies,
  clientGroups,
  clientServices,
  complianceSchedules,
  documentChecklistItems,
  leaveTypes,
  shiftTypes,
  clientRateOverrides,
  employeeCapabilities,
  employeeRates,
  salaryStructureLines,
  salaryStructures,
  timeEntries,
  trainingRecords,
  utilisationTargets,
  employeeProfiles,
  employeeWorkProfiles,
  legalEntities,
  officeTasks,
  registrations,
  roleDefinitions,
  rolePermissions,
  serviceCatalog,
  statutoryRateParameters,
  statutoryRateVersions,
  tenantMemberships,
  tenants,
  userCredentials,
  users,
  workItems,
  workDependencies,
  documentRequests,
} from "../../db/schema";
import { hashPassword } from "../../lib/auth/password";
import { demoDashboardRecords, SEEDED_TENANT_ID } from "../../lib/dashboard/fixtures";
import { closePostgresPool, getDatabase } from "../../lib/dashboard/postgres/pool";
import type { DashboardDatabase } from "../../lib/dashboard/postgres/repository";

const memberEmails: Record<string, string> = {
  "Loukesh Kumar": "loukesh@example.invalid",
  "Nisha S.": "nisha@example.invalid",
  "Rahul K.": "rahul@example.invalid",
  "Priya M.": "priya@example.invalid",
  "Vikram R.": "vikram@example.invalid",
  "Ayesha K.": "ayesha@example.invalid",
};

/**
 * The firm's rate card, in rupees per hour. Deliberately spread: a partner hour
 * is worth five of an associate's, which is what makes engagement margin worth
 * looking at rather than uniformly flattering.
 */
const chargeRatesByName: Record<string, number> = {
  "Priya M.": 6000,
  "Loukesh Kumar": 5000,
  "Rahul K.": 3500,
  "Nisha S.": 3500,
  "Vikram R.": 1200,
  // An articled assistant is not charged out at a member rate.
  "Ayesha K.": 600,
};

/** Partners draw no salary here, so payroll cannot cost them. */
const costRatesByName: Record<string, number> = { "Priya M.": 2500 };

/**
 * Monthly salary, in rupees. Cost per hour is derived from this rather than
 * typed, so a raise moves the margin without anyone maintaining a second number.
 * Employer contributions count: PF and ESI are as much the cost of the person as
 * the salary is.
 */
const salariesByName: Record<string, { basic: number; hra: number; special: number; employerPf: number }> = {
  "Nisha S.": { basic: 48000, hra: 24000, special: 23000, employerPf: 5760 },
  "Rahul K.": { basic: 46000, hra: 23000, special: 21000, employerPf: 5520 },
  "Vikram R.": { basic: 18000, hra: 9000, special: 6000, employerPf: 2160 },
  "Ayesha K.": { basic: 2500, hra: 0, special: 0, employerPf: 0 },
  "Loukesh Kumar": { basic: 60000, hra: 30000, special: 35000, employerPf: 7200 },
};

/**
 * Who is trusted with what. Deliberately uneven: the audit bench is two deep,
 * ROC rests on one person, and nobody can review bookkeeping — so the bench
 * panel has something true to show rather than a wall of green.
 */
const capabilitiesByName: Record<string, Array<{ service: string; level: string }>> = {
  "Priya M.": [
    { service: "AUDIT", level: "sign" }, { service: "10B", level: "sign" },
    { service: "ITR", level: "review" }, { service: "ROC", level: "review" },
  ],
  "Rahul K.": [
    { service: "AUDIT", level: "review" }, { service: "TDS", level: "review" },
    { service: "ITR", level: "prepare" }, { service: "10B", level: "prepare" },
  ],
  "Nisha S.": [
    { service: "GST", level: "sign" }, { service: "LUT", level: "review" },
    { service: "TDS", level: "prepare" }, { service: "BOOKS", level: "prepare" },
  ],
  "Vikram R.": [
    { service: "BOOKS", level: "prepare" }, { service: "GST", level: "prepare" },
    { service: "TDS", level: "learning" }, { service: "AUDIT", level: "learning" },
  ],
};

type SeedProfile = {
  designation: string; mobileNumber: string; joiningDate: string; notes: string;
  qualification: string; membershipNumber: string; qualifiedOn: string | null;
  /** Set explicitly: the column defaults to `confirmed`, which needs a date. */
  employmentStage?: "probation" | "confirmed";
  probationEndDate?: string | null;
};

const employeeProfilesByName: Record<string, SeedProfile> = {
  "Loukesh Kumar": { designation: "Firm Administrator", mobileNumber: "", joiningDate: "2020-04-01", notes: "Practice administration and operating controls.", qualification: "ca", membershipNumber: "200145", qualifiedOn: "2014-07-01" },
  "Nisha S.": { designation: "GST Manager", mobileNumber: "", joiningDate: "2021-07-12", notes: "GST delivery and client coordination.", qualification: "ca", membershipNumber: "231908", qualifiedOn: "2019-11-01" },
  "Rahul K.": { designation: "Audit Manager", mobileNumber: "", joiningDate: "2022-01-10", notes: "Audit, TDS, and quality review.", qualification: "ca", membershipNumber: "246077", qualifiedOn: "2021-05-01" },
  "Priya M.": { designation: "Assurance Partner", mobileNumber: "", joiningDate: "2019-06-03", notes: "Engagement oversight and partner review.", qualification: "ca", membershipNumber: "184220", qualifiedOn: "2011-01-01" },
  "Vikram R.": { designation: "Accounts Associate", mobileNumber: "", joiningDate: "2025-02-17", notes: "Bookkeeping, reconciliations, and compliance support.", qualification: "ca_inter", membershipNumber: "", qualifiedOn: null },
  "Ayesha K.": { designation: "Articled Assistant", mobileNumber: "", joiningDate: "2025-09-01", notes: "Practical training under CA Priya M.", qualification: "articled", membershipNumber: "", qualifiedOn: null, employmentStage: "probation", probationEndDate: "2026-03-01" },
};

const managerByName: Record<string, string | undefined> = {
  "Nisha S.": "Priya M.",
  "Rahul K.": "Priya M.",
  "Vikram R.": "Nisha S.",
};

const defaultServices = [
  { code: "BOOKS", name: "Bookkeeping", category: "Accounting" },
  { code: "GST", name: "GST compliance", category: "Indirect tax" },
  { code: "TDS", name: "TDS compliance", category: "Direct tax" },
  { code: "ITR", name: "Income-tax return", category: "Direct tax" },
  { code: "AUDIT", name: "Audit and assurance", category: "Assurance" },
  { code: "ROC", name: "ROC compliance", category: "Corporate law" },
  { code: "LUT", name: "Letter of undertaking", category: "Indirect tax" },
  { code: "10B", name: "Form 10B audit", category: "Assurance" },
] as const;

/**
 * Conventional published figures for FY 2026-27, seeded so payroll can suggest
 * deductions out of the box. They are firm-reviewable defaults, not statutory
 * advice: every version carries a source reference the firm is expected to
 * replace once it has verified the rates against the governing notification.
 */
const defaultStatutoryRateVersions = [
  {
    ruleType: "epf", jurisdiction: "IN", effectiveFrom: "2026-04-01",
    sourceReference: "Firm-reviewable default — verify against the EPF scheme notification.",
    parameters: [
      { parameterKey: "employee_rate_bp", numericValue: 1200, unit: "basis_points" },
      { parameterKey: "employer_rate_bp", numericValue: 1200, unit: "basis_points" },
      { parameterKey: "pension_rate_bp", numericValue: 833, unit: "basis_points" },
      { parameterKey: "wage_ceiling_paise", numericValue: 1_500_000, unit: "paise" },
      { parameterKey: "apply_ceiling", numericValue: 1, unit: "count" },
      { parameterKey: "rounding_up_to_rupee", numericValue: 0, unit: "count" },
    ],
  },
  {
    ruleType: "esi", jurisdiction: "IN", effectiveFrom: "2026-04-01",
    sourceReference: "Firm-reviewable default — verify against the ESI contribution notification.",
    parameters: [
      { parameterKey: "employee_rate_bp", numericValue: 75, unit: "basis_points" },
      { parameterKey: "employer_rate_bp", numericValue: 325, unit: "basis_points" },
      { parameterKey: "wage_threshold_paise", numericValue: 2_100_000, unit: "paise" },
      { parameterKey: "rounding_up_to_rupee", numericValue: 1, unit: "count" },
    ],
  },
  {
    ruleType: "professional_tax", jurisdiction: "BR", effectiveFrom: "2026-04-01",
    sourceReference: "Firm-reviewable default — verify against the Bihar professional tax schedule.",
    parameters: [
      { parameterKey: "pt_slab_1_upto_paise", numericValue: 2_500_000, unit: "paise" },
      { parameterKey: "pt_slab_1_amount_paise", numericValue: 0, unit: "paise" },
      { parameterKey: "pt_slab_2_upto_paise", numericValue: 4_166_600, unit: "paise" },
      { parameterKey: "pt_slab_2_amount_paise", numericValue: 10_400, unit: "paise" },
      { parameterKey: "pt_slab_3_upto_paise", numericValue: 8_333_300, unit: "paise" },
      { parameterKey: "pt_slab_3_amount_paise", numericValue: 20_800, unit: "paise" },
      { parameterKey: "pt_slab_4_upto_paise", numericValue: 9_999_999_99, unit: "paise" },
      { parameterKey: "pt_slab_4_amount_paise", numericValue: 41_600, unit: "paise" },
    ],
  },
] as const;

/**
 * The six leave codes that were previously fixed in the schema, seeded so every
 * historic leave request stays valid now that the list is firm-defined.
 */
const defaultLeaveTypes = [
  // Quotas are now enforced against a ledger, so how each type is *granted*
  // matters as much as its size. Maternity is a statutory entitlement sanctioned
  // per occasion — accruing 182 days to every employee every year would be
  // nonsense the moment a balance is shown to anyone.
  { code: "casual", name: "Casual leave", paidByDefault: true, allowsHalfDay: true, annualQuotaDays: 12, accrualMethod: "annual", carryForwardCap: 0, carryForwardExpiryMonths: null, encashableOnExit: false, displayOrder: 10 },
  { code: "sick", name: "Sick leave", paidByDefault: true, allowsHalfDay: true, annualQuotaDays: 12, accrualMethod: "annual", carryForwardCap: 0, carryForwardExpiryMonths: null, encashableOnExit: false, displayOrder: 20 },
  { code: "earned", name: "Earned leave", paidByDefault: true, allowsHalfDay: true, annualQuotaDays: 15, accrualMethod: "monthly", carryForwardCap: 30, carryForwardExpiryMonths: null, encashableOnExit: true, displayOrder: 30 },
  { code: "maternity", name: "Maternity leave", paidByDefault: true, allowsHalfDay: false, annualQuotaDays: 182, accrualMethod: "none", carryForwardCap: 0, carryForwardExpiryMonths: null, encashableOnExit: false, displayOrder: 40 },
  { code: "compensatory", name: "Compensatory off", paidByDefault: true, allowsHalfDay: true, annualQuotaDays: 0, accrualMethod: "none", carryForwardCap: 0, carryForwardExpiryMonths: null, encashableOnExit: false, displayOrder: 50 },
  { code: "other", name: "Other leave", paidByDefault: false, allowsHalfDay: true, annualQuotaDays: 0, accrualMethod: "none", carryForwardCap: 0, carryForwardExpiryMonths: null, encashableOnExit: false, displayOrder: 60 },
] as const;

/** One default shift matching the seeded attendance policy. */
const defaultShiftTypes = [
  { code: "GENERAL", name: "General shift", startTime: "09:30", endTime: "18:00", fullDayMinutes: 450, halfDayMinutes: 225, lateGraceMinutes: 15, workingWeekMask: "1111110", isDefault: true },
] as const;

/** Starter checklist the firm edits; these are common asks, not a required set. */
const defaultDocumentChecklist = [
  { code: "BANK_STMT", name: "Bank statement", category: "Accounting", serviceCode: "BOOKS", instructions: "All accounts, for the full period, in PDF or Excel.", defaultLeadDays: 7, mandatory: true },
  { code: "SALES_REG", name: "Sales register", category: "Indirect tax", serviceCode: "GST", instructions: "Invoice-wise sales for the return period.", defaultLeadDays: 7, mandatory: true },
  { code: "PURCHASE_REG", name: "Purchase register", category: "Indirect tax", serviceCode: "GST", instructions: "Invoice-wise purchases with supplier GSTINs.", defaultLeadDays: 7, mandatory: true },
  { code: "TDS_CHALLAN", name: "TDS challans", category: "Direct tax", serviceCode: "TDS", instructions: "Challan counterfoils for the quarter.", defaultLeadDays: 10, mandatory: true },
  { code: "FORM_16A", name: "Form 16A", category: "Direct tax", serviceCode: "ITR", instructions: "Downloaded from TRACES for the assessment year.", defaultLeadDays: 14, mandatory: false },
  { code: "PAN_COPY", name: "PAN copy", category: "Identity", serviceCode: "", instructions: "Legible copy of the entity or individual PAN card.", defaultLeadDays: 5, mandatory: true },
  { code: "TRIAL_BAL", name: "Trial balance", category: "Accounting", serviceCode: "AUDIT", instructions: "Signed trial balance for the financial year.", defaultLeadDays: 21, mandatory: true },
  { code: "BOARD_RES", name: "Board resolution", category: "Corporate law", serviceCode: "ROC", instructions: "Certified true copy, signed by a director.", defaultLeadDays: 14, mandatory: false },
] as const;

const defaultComplianceSchedules = [
  { code: "BOOKS", frequency: "monthly", dueMonthOffset: 1, dueDay: 10 },
  { code: "GST", frequency: "monthly", dueMonthOffset: 1, dueDay: 20 },
  { code: "TDS", frequency: "quarterly", dueMonthOffset: 1, dueDay: 31 },
  { code: "ITR", frequency: "annual", dueMonthOffset: 4, dueDay: 31 },
  { code: "AUDIT", frequency: "annual", dueMonthOffset: 6, dueDay: 30 },
  { code: "ROC", frequency: "annual", dueMonthOffset: 7, dueDay: 30 },
  { code: "10B", frequency: "annual", dueMonthOffset: 6, dueDay: 30 },
] as const;

const defaultEmployeeRoles = [
  { key: "partner", name: "Partner", description: "Firm-wide business approvals without user administration.", legacyRoleKey: "partner", permissions: ["dashboard:read", "clients:write", "work:write", "documents:read", "documents:write", "team:read", "tasks:read", "tasks:assign", "tasks:update:own", "attendance:use", "attendance:review", "salary:read:own", "salary:approve", "packages:read", "services:read", "client_packages:manage", "billing:read", "billing:manage", "registers:read", "registers:manage", "timesheets:use", "timesheets:manage"] },
  { key: "manager", name: "Manager", description: "Team and direct-report delivery supervision.", legacyRoleKey: "manager", permissions: ["dashboard:read", "clients:write", "work:write", "documents:read", "documents:write", "team:read", "tasks:read", "tasks:assign", "tasks:update:own", "attendance:use", "attendance:review", "salary:read:own", "packages:read", "services:read", "client_packages:manage", "registers:read", "registers:manage", "timesheets:use", "timesheets:manage"] },
  { key: "associate", name: "Associate", description: "Own and assigned client delivery work.", legacyRoleKey: "associate", permissions: ["dashboard:read", "tasks:read", "tasks:update:own", "attendance:use", "salary:read:own", "registers:read", "timesheets:use"] },
] as const;

export const SEEDED_ADMIN_EMAIL = "loukesh@example.invalid";
export const DEFAULT_DEVELOPMENT_ADMIN_PASSWORD = "SISPL-Local-2026!";

function stableUuid(prefix: string, ordinal: number) {
  return `${prefix}-0000-4000-8000-${ordinal.toString().padStart(12, "0")}`;
}

function developmentAdminPassword(env: NodeJS.ProcessEnv) {
  const configured = env.SISPL_DEV_ADMIN_PASSWORD?.trim();
  if (configured) return configured;
  if (env.NODE_ENV === "production") {
    throw new Error("SISPL_DEV_ADMIN_PASSWORD is required when seeding in production mode.");
  }
  return DEFAULT_DEVELOPMENT_ADMIN_PASSWORD;
}

export async function seedDevelopmentData(
  database: DashboardDatabase,
  options: { adminPassword?: string } = {},
) {
  const fixture = demoDashboardRecords;
  const memberIdByName = new Map(fixture.members.map((member) => [member.fullName, member.id]));
  const administrator = fixture.members.find((member) => member.roleKey === "firm_administrator");
  if (!administrator) throw new Error("The development fixture requires a firm administrator.");
  const adminPasswordHash = await hashPassword(options.adminPassword ?? developmentAdminPassword(process.env));

  await database.transaction(async (transaction) => {
    await transaction.insert(tenants).values({
      ...fixture.tenant,
      status: "active",
    }).onConflictDoUpdate({
      target: tenants.id,
      set: {
        legalName: fixture.tenant.legalName,
        displayName: fixture.tenant.displayName,
        slug: fixture.tenant.slug,
        status: "active",
        updatedAt: new Date(),
      },
    });

    const roleIdByKey = new Map<string, string>();
    for (const [index, role] of defaultEmployeeRoles.entries()) {
      const [existingRole] = await transaction.select({ id: roleDefinitions.id }).from(roleDefinitions).where(and(eq(roleDefinitions.tenantId, fixture.tenant.id), eq(roleDefinitions.key, role.key))).limit(1);
      const roleId = existingRole?.id ?? stableUuid("26000000", index + 1);
      if (existingRole) {
        await transaction.update(roleDefinitions).set({ name: role.name, description: role.description, roleClass: "employee", legacyRoleKey: role.legacyRoleKey, isSystem: true, status: "active", updatedAt: new Date() }).where(eq(roleDefinitions.id, roleId));
      } else {
        await transaction.insert(roleDefinitions).values({ id: roleId, tenantId: fixture.tenant.id, key: role.key, name: role.name, description: role.description, roleClass: "employee", legacyRoleKey: role.legacyRoleKey, isSystem: true, status: "active" });
      }
      roleIdByKey.set(role.key, roleId);
      await transaction.delete(rolePermissions).where(and(eq(rolePermissions.tenantId, fixture.tenant.id), eq(rolePermissions.roleDefinitionId, roleId)));
      await transaction.insert(rolePermissions).values(role.permissions.map((permissionKey, permissionIndex) => ({ id: stableUuid(`${27000000 + index}`, permissionIndex + 1), tenantId: fixture.tenant.id, roleDefinitionId: roleId, permissionKey })));
    }

    for (const [index, member] of fixture.members.entries()) {
      await transaction.insert(users).values({
        id: member.id,
        email: memberEmails[member.fullName] ?? `member-${index + 1}@example.invalid`,
        fullName: member.fullName,
        status: "active",
      }).onConflictDoUpdate({
        target: users.id,
        set: {
          email: memberEmails[member.fullName] ?? `member-${index + 1}@example.invalid`,
          fullName: member.fullName,
          status: "active",
        },
      });

      await transaction.insert(tenantMemberships).values({
        id: stableUuid("21000000", index + 1),
        tenantId: fixture.tenant.id,
        userId: member.id,
        roleKey: member.roleKey,
        accessClass: member.roleKey === "firm_administrator" ? "super_admin" : "employee",
        roleDefinitionId: member.roleKey === "firm_administrator" ? null : roleIdByKey.get(member.roleKey),
        status: member.status,
      }).onConflictDoUpdate({
        target: tenantMemberships.id,
        set: { roleKey: member.roleKey, accessClass: member.roleKey === "firm_administrator" ? "super_admin" : "employee", roleDefinitionId: member.roleKey === "firm_administrator" ? null : roleIdByKey.get(member.roleKey), status: member.status },
      });

      const profile = employeeProfilesByName[member.fullName];
      await transaction.insert(employeeProfiles).values({
        id: stableUuid("22000000", index + 1),
        tenantId: fixture.tenant.id,
        userId: member.id,
        employeeCode: `EMP-${String(index + 1).padStart(4, "0")}`,
        designation: profile?.designation ?? "Team Member",
        qualification: profile?.qualification ?? "other",
        membershipNumber: profile?.membershipNumber ?? "",
        qualifiedOn: profile?.qualifiedOn ?? null,
        mobileNumber: profile?.mobileNumber ?? "",
        joiningDate: profile?.joiningDate ?? "2026-04-01",
        // The column defaults to `confirmed`, which the database requires a date
        // for. Seeded staff have been confirmed since they joined.
        employmentStage: profile?.employmentStage ?? "confirmed",
        confirmedOn: (profile?.employmentStage ?? "confirmed") === "confirmed" ? profile?.joiningDate ?? "2026-04-01" : null,
        probationEndDate: profile?.probationEndDate ?? null,
        notes: profile?.notes ?? "",
      }).onConflictDoUpdate({
        target: employeeProfiles.id,
        set: {
          employmentStage: profile?.employmentStage ?? "confirmed",
          confirmedOn: (profile?.employmentStage ?? "confirmed") === "confirmed" ? profile?.joiningDate ?? "2026-04-01" : null,
          probationEndDate: profile?.probationEndDate ?? null,
          designation: profile?.designation ?? "Team Member",
          qualification: profile?.qualification ?? "other",
          membershipNumber: profile?.membershipNumber ?? "",
          qualifiedOn: profile?.qualifiedOn ?? null,
          mobileNumber: profile?.mobileNumber ?? "",
          joiningDate: profile?.joiningDate ?? "2026-04-01",
          employmentEndDate: null,
          notes: profile?.notes ?? "",
          updatedAt: new Date(),
        },
      });

      const salary = salariesByName[member.fullName];
      if (salary) {
        const structureId = stableUuid("23000000", index + 1);
        await transaction.insert(salaryStructures).values({
          id: structureId,
          tenantId: fixture.tenant.id,
          employeeUserId: member.id,
          effectiveFrom: "2026-04-01",
          status: "active",
          createdByUserId: fixture.members[0]!.id,
        }).onConflictDoUpdate({ target: salaryStructures.id, set: { updatedAt: new Date() } });

        const components = [
          { code: "BASIC", label: "Basic", kind: "earning", amount: salary.basic, order: 10 },
          { code: "HRA", label: "House rent allowance", kind: "earning", amount: salary.hra, order: 20 },
          { code: "SPECIAL", label: "Special allowance", kind: "earning", amount: salary.special, order: 30 },
          { code: "EMPLOYER_PF", label: "Employer PF", kind: "employer_contribution", amount: salary.employerPf, order: 40 },
        ] as const;
        for (const line of components) {
          await transaction.insert(salaryStructureLines).values({
            tenantId: fixture.tenant.id,
            salaryStructureId: structureId,
            code: line.code,
            label: line.label,
            kind: line.kind,
            monthlyAmountPaise: line.amount * 100,
            displayOrder: line.order,
          }).onConflictDoUpdate({
            target: [salaryStructureLines.tenantId, salaryStructureLines.salaryStructureId, salaryStructureLines.code],
            set: { monthlyAmountPaise: line.amount * 100, label: line.label, kind: line.kind },
          });
        }
      }

      const chargeRupees = chargeRatesByName[member.fullName];
      if (chargeRupees) {
        await transaction.insert(employeeRates).values({
          tenantId: fixture.tenant.id,
          employeeUserId: member.id,
          effectiveFrom: "2026-04-01",
          chargePaisePerHour: chargeRupees * 100,
          costPaisePerHour: costRatesByName[member.fullName] ? costRatesByName[member.fullName]! * 100 : null,
          note: "Opening rate card",
          createdByUserId: fixture.members[0]!.id,
        }).onConflictDoUpdate({
          target: [employeeRates.tenantId, employeeRates.employeeUserId, employeeRates.effectiveFrom],
          set: {
            chargePaisePerHour: chargeRupees * 100,
            costPaisePerHour: costRatesByName[member.fullName] ? costRatesByName[member.fullName]! * 100 : null,
            updatedAt: new Date(),
          },
        });
      }

    }

    // A second pass, because two foreign keys here point at another member's
    // membership row: `employee_capabilities_assessor_membership_fk` and
    // `employee_work_profiles_manager_membership_fk`. The assurance partner is
    // the fourth member, so naming her as assessor or manager from inside the
    // member loop referenced a membership that did not exist yet, and the seed
    // failed on any database where the rows were not already present.
    for (const [index, member] of fixture.members.entries()) {
      // Assessed by the assurance partner — except for the partner herself, who
      // is assessed by the firm administrator. Nobody rates their own capability,
      // and a seed that quietly dropped the partner's ratings would leave the
      // bench panel claiming the firm cannot review its own audit work.
      const assessorId = member.fullName === "Priya M."
        ? fixture.members.find((candidate) => candidate.fullName === "Loukesh Kumar")?.id
        : fixture.members.find((candidate) => candidate.fullName === "Priya M.")?.id;
      const capabilities = assessorId && assessorId !== member.id ? capabilitiesByName[member.fullName] ?? [] : [];
      for (const entry of capabilities) {
        await transaction.insert(employeeCapabilities).values({
          tenantId: fixture.tenant.id,
          employeeUserId: member.id,
          serviceCode: entry.service,
          level: entry.level,
          assessedByUserId: assessorId!,
          assessedOn: "2026-04-15",
          note: "",
        }).onConflictDoUpdate({
          target: [employeeCapabilities.tenantId, employeeCapabilities.employeeUserId, employeeCapabilities.serviceCode],
          set: { level: entry.level, assessedByUserId: assessorId!, assessedOn: "2026-04-15", updatedAt: new Date() },
        });
      }

      const managerName = managerByName[member.fullName];
      await transaction.insert(employeeWorkProfiles).values({
        id: stableUuid("23000000", index + 1),
        tenantId: fixture.tenant.id,
        employeeUserId: member.id,
        managerUserId: managerName ? memberIdByName.get(managerName) ?? null : null,
        employmentType: "employee",
        workLocationState: "Bihar",
      }).onConflictDoUpdate({
        target: [employeeWorkProfiles.tenantId, employeeWorkProfiles.employeeUserId],
        set: {
          managerUserId: managerName ? memberIdByName.get(managerName) ?? null : null,
          employmentType: "employee",
          workLocationState: "Bihar",
          updatedAt: new Date(),
        },
      });
    }

    await transaction.insert(attendancePolicies).values({
      id: stableUuid("24000000", 1),
      tenantId: fixture.tenant.id,
      effectiveFrom: "2026-01-01",
      jurisdictionState: "Bihar",
      timeZone: "Asia/Kolkata",
      workingWeekMask: "1111110",
      standardStartTime: "09:30",
      standardEndTime: "18:00",
      lateGraceMinutes: 15,
      fullDayMinutes: 450,
      halfDayMinutes: 225,
      createdByUserId: administrator.id,
    }).onConflictDoUpdate({
      target: [attendancePolicies.tenantId, attendancePolicies.effectiveFrom],
      set: {
        jurisdictionState: "Bihar", timeZone: "Asia/Kolkata", workingWeekMask: "1111110",
        standardStartTime: "09:30", standardEndTime: "18:00", lateGraceMinutes: 15,
        fullDayMinutes: 450, halfDayMinutes: 225,
      },
    });

    for (const [index, service] of defaultServices.entries()) {
      await transaction.insert(serviceCatalog).values({
        id: stableUuid("25000000", index + 1),
        tenantId: fixture.tenant.id,
        code: service.code,
        name: service.name,
        category: service.category,
        description: `${service.name} service for client engagements.`,
        status: "active",
      }).onConflictDoUpdate({
        target: serviceCatalog.id,
        set: {
          code: service.code,
          name: service.name,
          category: service.category,
          description: `${service.name} service for client engagements.`,
          status: "active",
          updatedAt: new Date(),
        },
      });
    }

    for (const [index, leave] of defaultLeaveTypes.entries()) {
      await transaction.insert(leaveTypes).values({
        id: stableUuid("32000000", index + 1), tenantId: fixture.tenant.id, ...leave, requiresReason: true, status: "active",
      }).onConflictDoUpdate({
        target: leaveTypes.id,
        set: { ...leave, requiresReason: true, status: "active", updatedAt: new Date() },
      });
    }

    for (const [index, shift] of defaultShiftTypes.entries()) {
      await transaction.insert(shiftTypes).values({
        id: stableUuid("33000000", index + 1), tenantId: fixture.tenant.id, ...shift, status: "active",
      }).onConflictDoUpdate({
        target: shiftTypes.id,
        set: { ...shift, status: "active", updatedAt: new Date() },
      });
    }

    for (const [index, item] of defaultDocumentChecklist.entries()) {
      await transaction.insert(documentChecklistItems).values({
        id: stableUuid("31000000", index + 1),
        tenantId: fixture.tenant.id,
        code: item.code,
        name: item.name,
        category: item.category,
        instructions: item.instructions,
        serviceCode: item.serviceCode,
        defaultLeadDays: item.defaultLeadDays,
        mandatory: item.mandatory,
        status: "active",
      }).onConflictDoUpdate({
        target: documentChecklistItems.id,
        set: {
          code: item.code, name: item.name, category: item.category, instructions: item.instructions,
          serviceCode: item.serviceCode, defaultLeadDays: item.defaultLeadDays, mandatory: item.mandatory,
          status: "active", updatedAt: new Date(),
        },
      });
    }

    for (const [index, version] of defaultStatutoryRateVersions.entries()) {
      const versionId = stableUuid("29000000", index + 1);
      await transaction.insert(statutoryRateVersions).values({
        id: versionId,
        tenantId: fixture.tenant.id,
        ruleType: version.ruleType,
        jurisdiction: version.jurisdiction,
        effectiveFrom: version.effectiveFrom,
        status: "active",
        sourceReference: version.sourceReference,
      }).onConflictDoUpdate({
        target: statutoryRateVersions.id,
        set: { status: "active", sourceReference: version.sourceReference, effectiveFrom: version.effectiveFrom, updatedAt: new Date() },
      });
      await transaction.delete(statutoryRateParameters).where(and(
        eq(statutoryRateParameters.tenantId, fixture.tenant.id),
        eq(statutoryRateParameters.versionId, versionId),
      ));
      await transaction.insert(statutoryRateParameters).values(version.parameters.map((parameter, parameterIndex) => ({
        id: stableUuid(`${30000000 + index}`, parameterIndex + 1),
        tenantId: fixture.tenant.id,
        versionId,
        parameterKey: parameter.parameterKey,
        numericValue: parameter.numericValue,
        unit: parameter.unit,
      })));
    }

    for (const [index, schedule] of defaultComplianceSchedules.entries()) {
      await transaction.insert(complianceSchedules).values({
        id: stableUuid("28000000", index + 1),
        tenantId: fixture.tenant.id,
        serviceCode: schedule.code,
        frequency: schedule.frequency,
        dueMonthOffset: schedule.dueMonthOffset,
        dueDay: schedule.dueDay,
        internalLeadDays: 3,
        effectiveFrom: "2026-04-01",
        status: "active",
      }).onConflictDoUpdate({
        target: complianceSchedules.id,
        set: {
          serviceCode: schedule.code,
          frequency: schedule.frequency,
          dueMonthOffset: schedule.dueMonthOffset,
          dueDay: schedule.dueDay,
          internalLeadDays: 3,
          effectiveFrom: "2026-04-01",
          status: "active",
          updatedAt: new Date(),
        },
      });
    }

    await transaction.insert(userCredentials).values({
      userId: administrator.id,
      passwordHash: adminPasswordHash,
    }).onConflictDoNothing();

    let serviceOrdinal = 1;
    let registrationOrdinal = 1;
    /**
     * A published procedure for GST, so an obligation raised for it carries real
     * steps and counts its own progress. The other services are deliberately
     * left uncovered, so the page can show what "no procedure" looks like.
     */
    const gstProcedureId = stableUuid("74000000", 1);
    await transaction.insert(procedureVersions).values({
      id: gstProcedureId,
      tenantId: fixture.tenant.id,
      serviceCode: "GST",
      version: 1,
      status: "published",
      effectiveFrom: "2026-04-01",
      note: "Monthly GST return procedure",
      publishedByUserId: fixture.members[0]!.id,
      publishedAt: new Date("2026-03-28T00:00:00Z"),
      createdByUserId: fixture.members[0]!.id,
    }).onConflictDoNothing();

    // No "manager review" step: review is a sign-off by somebody other than the
    // preparer, not a box the preparer ticks for themselves.
    const gstSteps = [
      { title: "Reconcile the sales register", instruction: "Against the books for the period.", mandatory: true },
      { title: "Reconcile the purchase register", instruction: "", mandatory: true },
      { title: "Match input credit to GSTR-2B", instruction: "List every mismatch and confirm with the client.", mandatory: true },
      { title: "Compute the liability", instruction: "", mandatory: true },
      { title: "File on the portal", instruction: "", mandatory: true },
      { title: "Save the acknowledgement to the client record", instruction: "", mandatory: true },
      { title: "Note observations for next period", instruction: "", mandatory: false },
    ] as const;
    // Replaced wholesale rather than upserted by index. A stable id keyed on
    // array position stops being stable the moment a step is inserted or removed
    // from the middle, and leaves an orphan behind at the old tail.
    await transaction.delete(procedureSteps).where(and(
      eq(procedureSteps.tenantId, fixture.tenant.id),
      eq(procedureSteps.procedureVersionId, gstProcedureId),
    ));
    for (const [index, step] of gstSteps.entries()) {
      await transaction.insert(procedureSteps).values({
        id: stableUuid("75000000", index + 1),
        tenantId: fixture.tenant.id,
        procedureVersionId: gstProcedureId,
        position: index + 1,
        title: step.title,
        instruction: step.instruction,
        mandatory: step.mandatory,
      });
    }

    /**
     * CPE requirements, left deliberately unconfirmed for the same reason the
     * articleship figures are: seeding them as confirmed would tell a firm that
     * somebody had checked when nobody had.
     */
    const cpeRequirements = [
      { category: "in_practice", yearlyStructured: 20, yearlyTotal: 20, blockStructured: 60, blockTotal: 120 },
      { category: "not_in_practice", yearlyStructured: 0, yearlyTotal: 15, blockStructured: 0, blockTotal: 60 },
      { category: "exempt", yearlyStructured: 0, yearlyTotal: 0, blockStructured: 0, blockTotal: 0 },
    ] as const;
    for (const requirement of cpeRequirements) {
      await transaction.insert(cpePolicies).values({
        tenantId: fixture.tenant.id,
        category: requirement.category,
        effectiveFrom: "2024-01-01",
        yearlyStructuredMinutes: requirement.yearlyStructured * 60,
        yearlyTotalMinutes: requirement.yearlyTotal * 60,
        blockYears: 3,
        blockStructuredMinutes: requirement.blockStructured * 60,
        blockTotalMinutes: requirement.blockTotal * 60,
        confirmed: false,
        note: "Placeholder. Check against the current ICAI announcement.",
        createdByUserId: fixture.members[0]!.id,
      }).onConflictDoNothing();
    }

    /**
     * A training history that is deliberately uneven: one member met, one short
     * only for the current year, one short across the block — which is the case
     * a yearly-only measure would have called compliant — and an article with
     * course training that carries no CPE weight at all.
     */
    const trainingPlan = [
      { who: "Priya M.", title: "Ind AS annual update", provider: "ICAI Board of Studies", type: "structured", on: "2024-07-18", hours: 22, service: "AUDIT" },
      { who: "Priya M.", title: "Audit quality review workshop", provider: "Regional council", type: "structured", on: "2025-08-12", hours: 22, service: "AUDIT" },
      { who: "Priya M.", title: "Company law amendments", provider: "Regional council", type: "structured", on: "2026-06-04", hours: 16, service: "ROC" },
      { who: "Priya M.", title: "Technical reading and circulars", provider: "In-house", type: "unstructured", on: "2026-07-30", hours: 6, service: "" },

      // Rahul clears both tests, so the register is not uniformly red and the
      // met band has something behind it.
      { who: "Rahul K.", title: "Tax audit clause-by-clause", provider: "Branch", type: "structured", on: "2024-09-05", hours: 22, service: "AUDIT" },
      { who: "Rahul K.", title: "Reading: guidance notes and circulars", provider: "In-house", type: "unstructured", on: "2024-11-30", hours: 20, service: "" },
      { who: "Rahul K.", title: "TDS and TCS refresher", provider: "Branch", type: "structured", on: "2025-06-20", hours: 21, service: "TDS" },
      { who: "Rahul K.", title: "Reading: case law digest", provider: "In-house", type: "unstructured", on: "2025-12-04", hours: 18, service: "" },
      { who: "Rahul K.", title: "Standards on Auditing update", provider: "ICAI", type: "structured", on: "2026-05-14", hours: 21, service: "AUDIT" },
      { who: "Rahul K.", title: "Reading: revised standards", provider: "In-house", type: "unstructured", on: "2026-08-01", hours: 18, service: "" },

      { who: "Nisha S.", title: "GST annual return and audit", provider: "Branch", type: "structured", on: "2026-07-02", hours: 20, service: "GST" },

      { who: "Loukesh Kumar", title: "Practice management and ethics", provider: "ICAI", type: "structured", on: "2026-03-11", hours: 8, service: "" },
      { who: "Loukesh Kumar", title: "Circulars and notifications review", provider: "In-house", type: "unstructured", on: "2026-06-26", hours: 5, service: "" },

      { who: "Ayesha K.", title: "ICITSS — information technology", provider: "ICAI", type: "course", on: "2025-08-14", hours: 90, service: "" },
      { who: "Ayesha K.", title: "In-house: audit sampling basics", provider: "In-house", type: "course", on: "2026-04-22", hours: 4, service: "AUDIT" },

      { who: "Vikram R.", title: "In-house: bank reconciliation practice", provider: "In-house", type: "course", on: "2026-05-08", hours: 3, service: "BOOKS" },
    ] as const;

    for (const [index, session] of trainingPlan.entries()) {
      const attendee = memberIdByName.get(session.who);
      if (!attendee) continue;
      await transaction.insert(trainingRecords).values({
        id: stableUuid("73000000", index + 1),
        tenantId: fixture.tenant.id,
        employeeUserId: attendee,
        title: session.title,
        provider: session.provider,
        learningType: session.type,
        completedOn: session.on,
        minutes: session.hours * 60,
        serviceCode: session.service,
        certificateReference: "",
        note: "",
        recordedByUserId: fixture.members[0]!.id,
      }).onConflictDoUpdate({
        // Every identifying field is overwritten, not only the measures. The id
        // is keyed on array position, so inserting a row mid-list changes what
        // each id means — and a partial update then leaves one person's name
        // sitting against another person's hours.
        target: trainingRecords.id,
        set: {
          employeeUserId: attendee,
          title: session.title,
          provider: session.provider,
          learningType: session.type,
          completedOn: session.on,
          minutes: session.hours * 60,
          serviceCode: session.service,
          updatedAt: new Date(),
        },
      });
    }

    /**
     * The articleship figures, left deliberately unconfirmed.
     *
     * ICAI revises the training period and the leave entitlement by
     * notification, and seeding them as confirmed would tell a firm that
     * somebody had checked when nobody had. The register says so on its face
     * until a member ticks the box.
     */
    await transaction.insert(articleshipPolicies).values({
      tenantId: fixture.tenant.id,
      effectiveFrom: "2025-04-01",
      trainingMonths: 24,
      leaveFractionNumerator: 1,
      leaveFractionDenominator: 6,
      confirmed: false,
      note: "Placeholder. Check against the current ICAI notification.",
      createdByUserId: fixture.members[0]!.id,
    }).onConflictDoNothing();

    const articleId = fixture.members.find((entry) => entry.fullName === "Ayesha K.")?.id;
    const principalId = fixture.members.find((entry) => entry.fullName === "Priya M.")?.id;
    if (articleId && principalId) {
      await transaction.insert(articleshipRegistrations).values({
        id: stableUuid("72000000", 1),
        tenantId: fixture.tenant.id,
        articleUserId: articleId,
        principalUserId: principalId,
        status: "active",
        commencedOn: "2025-09-01",
        trainingMonths: 24,
        registrationNumber: "SRO0412345",
        deedDate: "2025-09-01",
        form103Date: "2025-09-12",
        note: "",
        createdByUserId: fixture.members[0]!.id,
      }).onConflictDoNothing();
    }

    /**
     * Utilisation targets per role, so everybody is measured from their first
     * month without anyone configuring them. A partner sells less of their time
     * than an associate does, and an administrator sells none — a single firm
     * figure would mark two of the five as failing by design.
     */
    const roleTargets = [
      { roleKey: "partner", percent: 40, note: "Partner time is largely review, business and relationships." },
      { roleKey: "manager", percent: 65, note: "Delivery, less supervision and review of others." },
      { roleKey: "associate", percent: 80, note: "Mostly chargeable delivery." },
      { roleKey: "firm_administrator", percent: 0, note: "Practice administration is not sold." },
    ] as const;
    for (const target of roleTargets) {
      await transaction.insert(utilisationTargets).values({
        tenantId: fixture.tenant.id,
        scope: "role",
        roleKey: target.roleKey,
        employeeUserId: null,
        targetBasisPoints: target.percent * 100,
        effectiveFrom: "2026-04-01",
        note: target.note,
        createdByUserId: fixture.members[0]!.id,
      }).onConflictDoNothing();
    }

    // One negotiated rate, so the override path has something real behind it.
    const koshi = fixture.clients.find((entry) => entry.displayName.includes("Koshi"));
    const rahul = fixture.members.find((entry) => entry.fullName === "Rahul K.");
    if (koshi && rahul) {
      await transaction.insert(clientRateOverrides).values({
        tenantId: fixture.tenant.id,
        legalEntityId: koshi.id,
        employeeUserId: rahul.id,
        effectiveFrom: "2026-04-01",
        chargePaisePerHour: 2800 * 100,
        note: "Agreed at engagement renewal",
        createdByUserId: fixture.members[0]!.id,
      }).onConflictDoUpdate({
        target: [clientRateOverrides.tenantId, clientRateOverrides.legalEntityId, clientRateOverrides.employeeUserId, clientRateOverrides.effectiveFrom],
        set: { chargePaisePerHour: 2800 * 100, updatedAt: new Date() },
      });
    }

    for (const client of fixture.clients) {
      const ownerId = memberIdByName.get(client.ownerName);
      await transaction.insert(clientGroups).values({
        id: client.clientGroupId,
        tenantId: fixture.tenant.id,
        name: client.legalName,
        relationshipOwnerId: ownerId,
        riskStatus: client.riskStatus,
        healthScore: client.healthScore,
      }).onConflictDoUpdate({
        target: clientGroups.id,
        set: {
          name: client.legalName,
          relationshipOwnerId: ownerId,
          riskStatus: client.riskStatus,
          healthScore: client.healthScore,
          updatedAt: new Date(),
        },
      });

      await transaction.insert(legalEntities).values({
        id: client.id,
        tenantId: fixture.tenant.id,
        clientGroupId: client.clientGroupId,
        legalName: client.legalName,
        displayName: client.displayName,
        entityType: client.entityType,
        maskedPan: client.maskedPan,
        city: client.city,
        relationshipStart: client.relationshipStart,
        status: "active",
      }).onConflictDoUpdate({
        target: legalEntities.id,
        set: {
          legalName: client.legalName,
          displayName: client.displayName,
          entityType: client.entityType,
          maskedPan: client.maskedPan,
          city: client.city,
          relationshipStart: client.relationshipStart,
          status: "active",
          updatedAt: new Date(),
        },
      });

      for (const serviceKey of client.services) {
        await transaction.insert(clientServices).values({
          id: stableUuid("51000000", serviceOrdinal++),
          tenantId: fixture.tenant.id,
          legalEntityId: client.id,
          serviceKey,
          status: "active",
        }).onConflictDoUpdate({
          target: [clientServices.tenantId, clientServices.legalEntityId, clientServices.serviceKey],
          set: { status: "active" },
        });
      }

      for (let registration = 1; registration <= client.gstRegistrations; registration += 1) {
        const registrationKey = `gst-${registration}`;
        await transaction.insert(registrations).values({
          id: stableUuid("52000000", registrationOrdinal++),
          tenantId: fixture.tenant.id,
          legalEntityId: client.id,
          registrationType: "gst",
          registrationKey,
          status: "active",
        }).onConflictDoUpdate({
          target: [registrations.tenantId, registrations.legalEntityId, registrations.registrationKey],
          set: { status: "active" },
        });
      }
    }

    for (const item of fixture.workItems) {
      await transaction.insert(workItems).values({
        id: item.id,
        tenantId: fixture.tenant.id,
        legalEntityId: item.legalEntityId,
        serviceKey: item.serviceKey,
        periodKey: item.periodKey,
        status: item.status,
        statutoryDueDate: item.dueDate,
        internalDueDate: item.dueDate,
        assigneeId: memberIdByName.get(item.ownerName),
        blockerNote: item.blockerNote,
        progress: item.progress,
        missingItemCount: item.missingItems,
      }).onConflictDoUpdate({
        target: workItems.id,
        set: {
          status: item.status,
          statutoryDueDate: item.dueDate,
          internalDueDate: item.dueDate,
          assigneeId: memberIdByName.get(item.ownerName),
          blockerNote: item.blockerNote,
          progress: item.progress,
          missingItemCount: item.missingItems,
          updatedAt: new Date(),
        },
      });
    }

    // The one obligation in `waiting` waits on something nameable. Without this
    // the seeded database contradicts the rule the repository enforces: a status
    // claiming a wait, with nothing recorded that anybody could chase.
    const waitingItem = fixture.workItems.find((item) => item.status === "waiting");
    if (waitingItem) {
      const requestId = "70000000-0000-4000-8000-000000000009";
      await transaction.insert(documentRequests).values({
        id: requestId,
        tenantId: fixture.tenant.id,
        legalEntityId: waitingItem.legalEntityId,
        workItemId: waitingItem.id,
        requestedByUserId: memberIdByName.get(waitingItem.ownerName)!,
        title: "Bank statement — July 2026",
        description: "Current account statement for the month, for the monthly close.",
        dueDate: waitingItem.dueDate,
        status: "requested",
      }).onConflictDoNothing();
      await transaction.insert(workDependencies).values({
        id: "80000000-0000-4000-8000-000000000009",
        tenantId: fixture.tenant.id,
        workItemId: waitingItem.id,
        kind: "client_request",
        title: "Bank statement — July 2026",
        documentRequestId: requestId,
        expectedOn: waitingItem.dueDate,
        raisedByUserId: memberIdByName.get(waitingItem.ownerName)!,
      }).onConflictDoNothing();
    }

    const sampleTasks = [
      { title: "Resolve challan allocation exceptions", description: "Reconcile unmatched challans and document every allocation exception before reviewer handoff.", assignee: "Vikram R.", reviewer: "Rahul K.", priority: "urgent", status: "in_progress", dueDate: "2026-08-12", blockerNote: "Four challans still require client confirmation.", legalEntityId: fixture.workItems[0].legalEntityId, workItemId: fixture.workItems[0].id },
      { title: "Reconcile July purchase invoices", description: "Validate the purchase register against portal data and prepare an exception list for filing review.", assignee: "Nisha S.", reviewer: "Rahul K.", priority: "high", status: "waiting", dueDate: "2026-08-15", blockerNote: "Client confirmation is awaited for 18 invoices.", legalEntityId: fixture.workItems[1].legalEntityId, workItemId: fixture.workItems[1].id },
      { title: "Prepare weekly MCA follow-up list", description: "Compile the open MCA follow-ups across active clients and assign clear next actions.", assignee: "Vikram R.", reviewer: "Nisha S.", priority: "normal", status: "todo", dueDate: "2026-08-16", blockerNote: "", legalEntityId: null, workItemId: null },
      { title: "Review Form 10B clause evidence", description: "Perform manager-level evidence review and mark clauses requiring partner judgement.", assignee: "Rahul K.", reviewer: "Priya M.", priority: "high", status: "review", dueDate: "2026-08-22", blockerNote: "", legalEntityId: fixture.workItems[3].legalEntityId, workItemId: fixture.workItems[3].id },
      { title: "Collect renewed engagement letter", description: "Coordinate the renewed engagement letter and save the signed version to the client record.", assignee: "Nisha S.", reviewer: "Priya M.", priority: "normal", status: "todo", dueDate: "2026-08-18", blockerNote: "", legalEntityId: fixture.clients[3].id, workItemId: null },
    ] as const;

    for (const [index, task] of sampleTasks.entries()) {
      await transaction.insert(officeTasks).values({
        id: stableUuid("70000000", index + 1),
        tenantId: fixture.tenant.id,
        title: task.title,
        description: task.description,
        assigneeId: memberIdByName.get(task.assignee)!,
        reviewerId: memberIdByName.get(task.reviewer)!,
        assignedByUserId: administrator.id,
        priority: task.priority,
        status: task.status,
        dueDate: task.dueDate,
        blockerNote: task.blockerNote,
        legalEntityId: task.legalEntityId,
        workItemId: task.workItemId,
      }).onConflictDoUpdate({
        target: officeTasks.id,
        set: {
          title: task.title,
          description: task.description,
          assigneeId: memberIdByName.get(task.assignee)!,
          reviewerId: memberIdByName.get(task.reviewer)!,
          priority: task.priority,
          status: task.status,
          dueDate: task.dueDate,
          blockerNote: task.blockerNote,
          legalEntityId: task.legalEntityId,
          workItemId: task.workItemId,
          updatedAt: new Date(),
        },
      });
    }

    /**
     * A worked August, so the rate card has something to value and utilisation
     * has something to measure.
     *
     * Deliberately uneven, because a month where everybody hits their number
     * demonstrates nothing: the associate's timesheet is substantially unfilled,
     * one manager sits under target, and the administrator sells no time at all
     * and is correctly on target for it.
     */
    const workingDays: string[] = [];
    for (let day = 1; day <= 31; day += 1) {
      const date = new Date(Date.UTC(2026, 7, day));
      // Monday to Saturday, matching the firm's default working week.
      if (date.getUTCDay() !== 0) workingDays.push(`2026-08-${String(day).padStart(2, "0")}`);
    }

    // 26 working days at 7.5 hours is 195 hours available each. Chargeable and
    // non-chargeable minutes are per recorded day; `recordedDays` is how much of
    // the month the person actually filled in.
    const timePlans = [
      { who: "Nisha S.", recordedDays: 25, chargeable: 315, other: 130, client: fixture.clients[0].id, second: fixture.clients[1].id, chargeNarration: "GST return preparation and reconciliation", otherNarration: "Client calls and internal review" },
      { who: "Rahul K.", recordedDays: 25, chargeable: 285, other: 160, client: fixture.clients[1].id, second: fixture.clients[0].id, chargeNarration: "Statutory audit fieldwork", otherNarration: "Team supervision and file review" },
      { who: "Priya M.", recordedDays: 24, chargeable: 195, other: 250, client: fixture.clients[2].id, second: fixture.clients[1].id, chargeNarration: "Engagement review and partner sign-off", otherNarration: "Business development and firm management" },
      { who: "Loukesh Kumar", recordedDays: 24, chargeable: 0, other: 445, client: null, second: null, chargeNarration: "", otherNarration: "Practice administration and operating controls" },
      // Deliberately short, so the unrecorded-time signal has something true to
      // report. A month where everybody fills in their timesheet demonstrates
      // nothing about the one measure that used to be impossible to see.
      { who: "Vikram R.", recordedDays: 14, chargeable: 390, other: 55, client: fixture.clients[0].id, second: fixture.clients[4].id, chargeNarration: "Bookkeeping and bank reconciliation", otherNarration: "Internal training on the GST portal" },
    ] as const;

    let timeOrdinal = 0;
    for (const plan of timePlans) {
      const employeeUserId = memberIdByName.get(plan.who)!;
      for (const [dayIndex, date] of workingDays.entries()) {
        if (dayIndex >= plan.recordedDays) break;

        if (plan.chargeable > 0) {
          await transaction.insert(timeEntries).values({
            id: stableUuid("71000000", ++timeOrdinal),
            tenantId: fixture.tenant.id,
            employeeUserId,
            entryDate: date,
            minutes: plan.chargeable,
            legalEntityId: dayIndex % 3 === 2 ? plan.second : plan.client,
            billable: true,
            narration: plan.chargeNarration,
          }).onConflictDoUpdate({
            target: timeEntries.id,
            set: {
              employeeUserId, entryDate: date, minutes: plan.chargeable,
              legalEntityId: dayIndex % 3 === 2 ? plan.second : plan.client,
              billable: true, narration: plan.chargeNarration, updatedAt: new Date(),
            },
          });
        }

        if (plan.other > 0) {
          await transaction.insert(timeEntries).values({
            id: stableUuid("71000000", ++timeOrdinal),
            tenantId: fixture.tenant.id,
            employeeUserId,
            entryDate: date,
            minutes: plan.other,
            legalEntityId: plan.chargeable === 0 ? null : plan.client,
            billable: false,
            narration: plan.otherNarration,
          }).onConflictDoUpdate({
            target: timeEntries.id,
            set: {
              employeeUserId, entryDate: date, minutes: plan.other,
              legalEntityId: plan.chargeable === 0 ? null : plan.client,
              billable: false, narration: plan.otherNarration, updatedAt: new Date(),
            },
          });
        }
      }
    }
  });
}

export async function getSeedCounts(database: DashboardDatabase, tenantId: string) {
  const [[tenantCount], [groupCount], [entityCount], [workCount], [employeeCount], [taskCount], [workProfileCount], [attendancePolicyCount]] = await Promise.all([
    database.select({ value: count() }).from(tenants).where(eq(tenants.id, tenantId)),
    database.select({ value: count() }).from(clientGroups).where(eq(clientGroups.tenantId, tenantId)),
    database.select({ value: count() }).from(legalEntities).where(eq(legalEntities.tenantId, tenantId)),
    database.select({ value: count() }).from(workItems).where(eq(workItems.tenantId, tenantId)),
    database.select({ value: count() }).from(employeeProfiles).where(eq(employeeProfiles.tenantId, tenantId)),
    database.select({ value: count() }).from(officeTasks).where(eq(officeTasks.tenantId, tenantId)),
    database.select({ value: count() }).from(employeeWorkProfiles).where(eq(employeeWorkProfiles.tenantId, tenantId)),
    database.select({ value: count() }).from(attendancePolicies).where(eq(attendancePolicies.tenantId, tenantId)),
  ]);
  return {
    attendancePolicies: attendancePolicyCount?.value ?? 0,
    tenants: tenantCount?.value ?? 0,
    clientGroups: groupCount?.value ?? 0,
    legalEntities: entityCount?.value ?? 0,
    workItems: workCount?.value ?? 0,
    employeeProfiles: employeeCount?.value ?? 0,
    officeTasks: taskCount?.value ?? 0,
    workProfiles: workProfileCount?.value ?? 0,
  };
}

async function main() {
  const database = getDatabase();
  await seedDevelopmentData(database);
  const counts = await getSeedCounts(database, SEEDED_TENANT_ID);
  console.log(`Seed complete: ${counts.legalEntities} clients, ${counts.workItems} compliance work items, ${counts.employeeProfiles} employees, and ${counts.officeTasks} office tasks.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch(() => {
      console.error("Database seed failed. Verify DATABASE_URL and run the migration first.");
      process.exitCode = 1;
    })
    .finally(closePostgresPool);
}
