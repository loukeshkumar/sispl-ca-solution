import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDisbursementBatch,
  buildDisbursementCsv,
  DEFAULT_RTGS_THRESHOLD_PAISE,
  DISBURSEMENT_COLUMNS,
  maskAccountNumber,
  paiseToAmountString,
  selectPaymentMode,
  type DisbursementCandidate,
} from "../lib/payroll/disbursement";
import { validateBankAccountFields } from "../lib/payroll/bank-accounts";

const payable = (overrides: Partial<DisbursementCandidate> = {}): DisbursementCandidate => ({
  employeeUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  employeeCode: "EMP001",
  employeeName: "Nisha Sharma",
  netPayPaise: 4_500_000,
  hold: false,
  holdReason: "",
  accountHolderName: "Nisha Sharma",
  accountNumber: "12345678901",
  ifscCode: "SBIN0001234",
  bankName: "State Bank of India",
  ...overrides,
});

test("payment mode follows the RTGS threshold and is overridable", () => {
  assert.equal(selectPaymentMode(19_999_999), "NEFT");
  assert.equal(selectPaymentMode(DEFAULT_RTGS_THRESHOLD_PAISE), "RTGS");
  assert.equal(selectPaymentMode(5_000_000, 1_000_000), "RTGS", "a firm may lower the threshold");
});

test("account numbers are masked to the last four digits wherever they are shown", () => {
  assert.equal(maskAccountNumber("12345678901"), "*******8901");
  assert.equal(maskAccountNumber("1234"), "****");
  assert.equal(maskAccountNumber("123"), "***");
});

test("amounts convert from paise without floating point drift", () => {
  assert.equal(paiseToAmountString(4_500_000), "45000.00");
  assert.equal(paiseToAmountString(500_050), "5000.50");
  assert.equal(paiseToAmountString(5), "0.05");
  assert.throws(() => paiseToAmountString(-1), /non-negative integer paise/);
});

test("held employees, nil pay, and missing instructions are excluded with a stated reason", () => {
  const batch = buildDisbursementBatch([
    payable(),
    payable({ employeeCode: "EMP002", hold: true, holdReason: "Notice period dispute" }),
    payable({ employeeCode: "EMP003", netPayPaise: 0 }),
    payable({ employeeCode: "EMP004", accountNumber: null, ifscCode: null, bankName: null, accountHolderName: null }),
  ], { periodKey: "2026-08" });

  assert.equal(batch.instructions.length, 1);
  assert.equal(batch.totalAmountPaise, 4_500_000);
  assert.deepEqual(batch.exclusions.map((exclusion) => [exclusion.employeeCode, exclusion.reason]), [
    ["EMP002", "on_hold"],
    ["EMP003", "zero_net_pay"],
    ["EMP004", "no_bank_account"],
  ]);
  assert.equal(batch.exclusions[0].detail, "Notice period dispute");
});

test("the batch total is the sum of only the instructions that will actually be paid", () => {
  const batch = buildDisbursementBatch([
    payable({ employeeCode: "EMP001", netPayPaise: 1_000_000 }),
    payable({ employeeCode: "EMP002", netPayPaise: 2_000_000 }),
    payable({ employeeCode: "EMP003", netPayPaise: 9_000_000, hold: true }),
  ], { periodKey: "2026-08" });
  assert.equal(batch.instructions.length, 2);
  assert.equal(batch.totalAmountPaise, 3_000_000);
});

test("the beneficiary name falls back to the employee name when no holder name is recorded", () => {
  const batch = buildDisbursementBatch([payable({ accountHolderName: "   " })], { periodKey: "2026-08" });
  assert.equal(batch.instructions[0].beneficiaryName, "Nisha Sharma");
});

test("narration is bank-safe: no punctuation and within the 35 character limit", () => {
  const batch = buildDisbursementBatch([payable({ employeeCode: "EMP001" })], { periodKey: "August 2026 · Q2" });
  const narration = batch.instructions[0].narration;
  assert.ok(narration.length <= 35);
  assert.match(narration, /^[A-Za-z0-9 -]+$/);
  assert.ok(narration.startsWith("SALARY"));
});

test("the CSV carries every column a bank needs and quotes embedded separators", () => {
  const batch = buildDisbursementBatch([
    payable({ bankName: 'Bank "Of" India, Ltd', accountHolderName: "Sharma, Nisha" }),
  ], { periodKey: "2026-08" });
  const csv = buildDisbursementCsv(batch, { paymentDate: "2026-08-31" });
  const [header, row] = csv.split("\r\n");
  assert.equal(header, DISBURSEMENT_COLUMNS.join(","));
  assert.ok(row.includes('"Sharma, Nisha"'));
  assert.ok(row.includes('"Bank ""Of"" India, Ltd"'));
  assert.ok(row.includes("SBIN0001234"));
  assert.ok(row.includes("45000.00"));
  assert.ok(row.includes("NEFT"));
  assert.ok(row.includes("2026-08-31"));
});

test("an empty batch still emits the header so the file is never malformed", () => {
  const csv = buildDisbursementCsv({ instructions: [], exclusions: [], totalAmountPaise: 0 }, { paymentDate: "2026-08-31" });
  assert.equal(csv, DISBURSEMENT_COLUMNS.join(","));
});

test("bank account validation normalises input and enforces the IFSC format", () => {
  const result = validateBankAccountFields({
    employeeUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    accountHolderName: "  Nisha   Sharma ",
    accountNumber: "1234 5678-901",
    ifscCode: " sbin0001234 ",
    bankName: "State Bank of India",
    accountType: "savings",
  });
  assert.ok(result.success);
  assert.equal(result.data.accountHolderName, "Nisha Sharma");
  assert.equal(result.data.accountNumber, "12345678901", "spaces and dashes are stripped from the account number");
  assert.equal(result.data.ifscCode, "SBIN0001234");
});

test("bank account validation rejects malformed IFSC codes and account numbers", () => {
  const base = {
    employeeUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    accountHolderName: "Nisha Sharma", accountNumber: "12345678901",
    ifscCode: "SBIN0001234", bankName: "SBI", accountType: "savings",
  };
  assert.ok(!validateBankAccountFields({ ...base, ifscCode: "SBIN1001234" }).success, "the fifth character must be zero");
  assert.ok(!validateBankAccountFields({ ...base, ifscCode: "SBIN000123" }).success, "IFSC must be 11 characters");
  assert.ok(!validateBankAccountFields({ ...base, accountNumber: "12AB5678" }).success);
  assert.ok(!validateBankAccountFields({ ...base, accountNumber: "1234" }).success);
  assert.ok(!validateBankAccountFields({ ...base, accountType: "loan" }).success);
});
