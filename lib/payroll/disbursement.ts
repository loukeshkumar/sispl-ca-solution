/**
 * Bank disbursement file generation.
 *
 * Banks each publish their own bulk-upload template, so this emits a generic
 * NEFT/RTGS/IMPS instruction CSV carrying the fields every Indian bank requires.
 * The firm maps it onto their bank's sheet. SISPL never connects to a bank and
 * never initiates a payment — generating a file is a preparation step, and the
 * money only moves when someone uploads it and authorises it at the bank.
 */

export type PaymentMode = "NEFT" | "RTGS" | "IMPS";

/** RTGS is conventionally used at or above ₹2,00,000; the firm may override. */
export const DEFAULT_RTGS_THRESHOLD_PAISE = 20_000_000;

export type DisbursementCandidate = {
  employeeUserId: string;
  employeeCode: string;
  employeeName: string;
  netPayPaise: number;
  hold: boolean;
  holdReason: string;
  accountHolderName: string | null;
  accountNumber: string | null;
  ifscCode: string | null;
  bankName: string | null;
};

export type DisbursementInstruction = {
  employeeCode: string;
  beneficiaryName: string;
  accountNumber: string;
  ifscCode: string;
  bankName: string;
  amountPaise: number;
  mode: PaymentMode;
  narration: string;
};

export type DisbursementExclusion = {
  employeeCode: string;
  employeeName: string;
  reason: "on_hold" | "no_bank_account" | "zero_net_pay";
  detail: string;
};

export type DisbursementBatch = {
  instructions: DisbursementInstruction[];
  exclusions: DisbursementExclusion[];
  totalAmountPaise: number;
};

export function selectPaymentMode(amountPaise: number, rtgsThresholdPaise = DEFAULT_RTGS_THRESHOLD_PAISE): PaymentMode {
  return amountPaise >= rtgsThresholdPaise ? "RTGS" : "NEFT";
}

export function maskAccountNumber(accountNumber: string) {
  const digits = accountNumber.trim();
  if (digits.length <= 4) return "*".repeat(digits.length);
  return `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

export function paiseToAmountString(paise: number) {
  if (!Number.isSafeInteger(paise) || paise < 0) throw new Error("Disbursement amounts must be non-negative integer paise.");
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;
}

function narrationFor(periodKey: string, employeeCode: string) {
  return `SALARY ${periodKey} ${employeeCode}`.replace(/[^A-Za-z0-9 -]/g, "").slice(0, 35);
}

/**
 * Held employees and employees without payment instructions are excluded rather
 * than silently skipped, so the firm can see exactly who will not be paid.
 */
export function buildDisbursementBatch(
  candidates: DisbursementCandidate[],
  options: { periodKey: string; rtgsThresholdPaise?: number },
): DisbursementBatch {
  const instructions: DisbursementInstruction[] = [];
  const exclusions: DisbursementExclusion[] = [];
  for (const candidate of candidates) {
    if (candidate.hold) {
      exclusions.push({ employeeCode: candidate.employeeCode, employeeName: candidate.employeeName, reason: "on_hold", detail: candidate.holdReason || "Payment held" });
      continue;
    }
    if (candidate.netPayPaise <= 0) {
      exclusions.push({ employeeCode: candidate.employeeCode, employeeName: candidate.employeeName, reason: "zero_net_pay", detail: "Net pay is nil" });
      continue;
    }
    if (!candidate.accountNumber || !candidate.ifscCode || !candidate.bankName) {
      exclusions.push({ employeeCode: candidate.employeeCode, employeeName: candidate.employeeName, reason: "no_bank_account", detail: "No active bank account on file" });
      continue;
    }
    instructions.push({
      employeeCode: candidate.employeeCode,
      beneficiaryName: candidate.accountHolderName?.trim() || candidate.employeeName,
      accountNumber: candidate.accountNumber,
      ifscCode: candidate.ifscCode,
      bankName: candidate.bankName,
      amountPaise: candidate.netPayPaise,
      mode: selectPaymentMode(candidate.netPayPaise, options.rtgsThresholdPaise),
      narration: narrationFor(options.periodKey, candidate.employeeCode),
    });
  }
  return {
    instructions,
    exclusions,
    totalAmountPaise: instructions.reduce((sum, instruction) => sum + instruction.amountPaise, 0),
  };
}

function csvField(value: string) {
  const normalized = value.replace(/[\r\n]+/g, " ");
  return /[",]/.test(normalized) ? `"${normalized.replaceAll('"', '""')}"` : normalized;
}

export const DISBURSEMENT_COLUMNS = [
  "BeneficiaryName",
  "BeneficiaryAccountNumber",
  "IFSC",
  "BankName",
  "Amount",
  "PaymentMode",
  "PaymentDate",
  "Narration",
  "EmployeeCode",
] as const;

export function buildDisbursementCsv(batch: DisbursementBatch, options: { paymentDate: string }) {
  const rows = batch.instructions.map((instruction) => [
    instruction.beneficiaryName,
    instruction.accountNumber,
    instruction.ifscCode,
    instruction.bankName,
    paiseToAmountString(instruction.amountPaise),
    instruction.mode,
    options.paymentDate,
    instruction.narration,
    instruction.employeeCode,
  ].map(csvField).join(","));
  return [DISBURSEMENT_COLUMNS.join(","), ...rows].join("\r\n");
}
