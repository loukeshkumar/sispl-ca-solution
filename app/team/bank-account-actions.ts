"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "../../lib/auth/server";
import { getDatabase } from "../../lib/dashboard/postgres/pool";
import { BankAccountError, replaceBankAccount, validateBankAccountFields, type BankAccountActionState } from "../../lib/payroll/bank-accounts";

export async function replaceBankAccountAction(employeeId: string, _previous: BankAccountActionState, formData: FormData): Promise<BankAccountActionState> {
  const session = await requirePermission("salary:manage", `/team/${employeeId}`);
  const validation = validateBankAccountFields(Object.fromEntries(
    [...formData.entries()].filter(([, value]) => typeof value === "string").map(([key, value]) => [key, String(value)]),
  ));
  if (!validation.success) return { error: "Review the highlighted fields.", fieldErrors: validation.fieldErrors };
  try {
    await replaceBankAccount(getDatabase(), session.tenantId, session.userId, validation.data);
  } catch (error) {
    return {
      error: error instanceof BankAccountError ? error.message : "The payment instructions could not be saved.",
      fieldErrors: {},
    };
  }
  revalidatePath(`/team/${employeeId}`);
  return { error: "", fieldErrors: {} };
}
