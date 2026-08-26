import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { auditEvents, employeeBankAccounts, tenantMemberships } from "../../db/schema";
import type { DashboardDatabase } from "../dashboard/postgres/repository";
import { maskAccountNumber } from "./disbursement";

export class BankAccountError extends Error {
  constructor(public readonly code: "not_found" | "invalid_member") {
    super(code === "not_found" ? "The bank account was not found." : "Select an active member of this firm.");
    this.name = "BankAccountError";
  }
}

export type BankAccountInput = {
  employeeUserId: string;
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  bankName: string;
  accountType: "savings" | "current";
};

export type BankAccountFieldErrors = Partial<Record<keyof BankAccountInput, string>>;
export type BankAccountActionState = { error: string; fieldErrors: BankAccountFieldErrors };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCOUNT_PATTERN = /^[0-9]{5,20}$/;
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export function validateBankAccountFields(fields: Record<string, string | undefined>):
  | { success: true; data: BankAccountInput }
  | { success: false; fieldErrors: BankAccountFieldErrors } {
  const employeeUserId = fields.employeeUserId?.trim() ?? "";
  const accountHolderName = (fields.accountHolderName ?? "").trim().replace(/\s+/g, " ");
  const accountNumber = (fields.accountNumber ?? "").replace(/[\s-]/g, "");
  const ifscCode = (fields.ifscCode ?? "").trim().toUpperCase();
  const bankName = (fields.bankName ?? "").trim().replace(/\s+/g, " ");
  const accountType = (fields.accountType ?? "savings").trim();
  const fieldErrors: BankAccountFieldErrors = {};

  if (!UUID_PATTERN.test(employeeUserId)) fieldErrors.employeeUserId = "Select a valid employee.";
  if (accountHolderName.length < 2 || accountHolderName.length > 120) fieldErrors.accountHolderName = "Enter the name exactly as it appears on the bank account.";
  if (!ACCOUNT_PATTERN.test(accountNumber)) fieldErrors.accountNumber = "Enter the account number as 5 to 20 digits.";
  if (!IFSC_PATTERN.test(ifscCode)) fieldErrors.ifscCode = "Enter a valid 11-character IFSC, e.g. SBIN0001234.";
  if (bankName.length < 2 || bankName.length > 120) fieldErrors.bankName = "Enter the bank name.";
  if (accountType !== "savings" && accountType !== "current") fieldErrors.accountType = "Select a valid account type.";

  if (Object.keys(fieldErrors).length) return { success: false, fieldErrors };
  return { success: true, data: { employeeUserId, accountHolderName, accountNumber, ifscCode, bankName, accountType: accountType as "savings" | "current" } };
}

export type BankAccountView = {
  id: string;
  accountHolderName: string;
  maskedAccountNumber: string;
  ifscCode: string;
  bankName: string;
  accountType: string;
};

/** Only ever returns a masked account number; the full value stays server-side. */
export async function getActiveBankAccount(database: DashboardDatabase, tenantId: string, employeeUserId: string): Promise<BankAccountView | null> {
  if (!tenantId.trim() || !employeeUserId.trim()) return null;
  const [row] = await database.select({
    id: employeeBankAccounts.id,
    accountHolderName: employeeBankAccounts.accountHolderName,
    accountNumber: employeeBankAccounts.accountNumber,
    ifscCode: employeeBankAccounts.ifscCode,
    bankName: employeeBankAccounts.bankName,
    accountType: employeeBankAccounts.accountType,
  }).from(employeeBankAccounts).where(and(
    eq(employeeBankAccounts.tenantId, tenantId),
    eq(employeeBankAccounts.employeeUserId, employeeUserId),
    eq(employeeBankAccounts.status, "active"),
  )).limit(1);
  if (!row) return null;
  const { accountNumber, ...rest } = row;
  return { ...rest, maskedAccountNumber: maskAccountNumber(accountNumber) };
}

/** Replacing payment instructions retires the previous account rather than editing it. */
export async function replaceBankAccount(database: DashboardDatabase, tenantId: string, actorUserId: string, input: BankAccountInput) {
  if (!tenantId.trim() || !actorUserId.trim()) throw new Error("Tenant and actor are required.");
  return database.transaction(async (transaction) => {
    const [member] = await transaction.select({ userId: tenantMemberships.userId }).from(tenantMemberships).where(and(
      eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.userId, input.employeeUserId), eq(tenantMemberships.status, "active"),
    )).limit(1);
    if (!member) throw new BankAccountError("invalid_member");
    await transaction.update(employeeBankAccounts).set({ status: "inactive", updatedAt: new Date() }).where(and(
      eq(employeeBankAccounts.tenantId, tenantId),
      eq(employeeBankAccounts.employeeUserId, input.employeeUserId),
      eq(employeeBankAccounts.status, "active"),
    ));
    const id = randomUUID();
    await transaction.insert(employeeBankAccounts).values({ id, tenantId, ...input, status: "active", recordedByUserId: actorUserId });
    // The audit trail records that instructions changed, never the account number.
    await transaction.insert(auditEvents).values({
      tenantId, actorUserId, resourceType: "employee_bank_account", resourceId: id,
      action: "bank_account.replaced", reason: `${input.bankName} ${input.ifscCode}`,
    });
    return id;
  });
}
