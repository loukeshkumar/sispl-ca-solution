"use client";

import { useActionState, useState } from "react";

import type { PayrollRunDetail } from "../../../../lib/payroll/repository";
import type { StatutorySuggestionResult } from "../../../../lib/statutory/repository";
import { updatePayrollEntryAction, type SalaryActionState } from "../../actions";

const initialState: SalaryActionState = { error: "", fieldErrors: {} };
const money = (paise: number) => (paise / 100).toFixed(2);

const ruleLabels: Record<string, string> = { epf: "EPF", esi: "ESI", professional_tax: "Professional tax" };

export function PayrollEntryEditor({
  entry,
  runId,
  statutory,
}: {
  entry: PayrollRunDetail["entries"][number];
  runId: string;
  statutory?: StatutorySuggestionResult | null;
}) {
  const [state, action, pending] = useActionState(updatePayrollEntryAction, initialState);
  const [applied, setApplied] = useState(false);
  const suggestion = statutory?.suggestion;
  const suggestionKey = applied ? "suggested" : "recorded";

  return <details className="payroll-entry-editor"><summary><span><strong>{entry.employeeName}</strong><small>{entry.employeeCode} · {entry.designation}</small></span><span><strong>₹{money(entry.netPayPaise)}</strong><small>{entry.payableHalfDays / 2} payable days</small></span></summary>
    {statutory && (
      <div className="statutory-suggestion">
        <div className="statutory-suggestion-heading">
          <strong>Computed from the rules in force</strong>
          <button
            className="statutory-apply-button"
            onClick={() => setApplied(true)}
            type="button"
          >
            Use these values
          </button>
        </div>
        {suggestion && (
          <ul>
            <li><span>Employee PF</span><b>₹{money(suggestion.employeeProvidentFundPaise)}</b></li>
            <li><span>Employee ESI</span><b>{suggestion.esiApplicable ? `₹${money(suggestion.employeeStateInsurancePaise)}` : "Not applicable"}</b></li>
            <li><span>Professional tax</span><b>₹{money(suggestion.professionalTaxPaise)}</b></li>
            <li><span>Employer PF · pension</span><b>₹{money(suggestion.employerProvidentFundPaise)} · ₹{money(suggestion.employerPensionPaise)}</b></li>
          </ul>
        )}
        {statutory.versions.length > 0 && (
          <small>
            Rule versions: {statutory.versions.map((version) => `${ruleLabels[version.ruleType] ?? version.ruleType} ${version.jurisdiction} effective ${version.effectiveFrom}`).join(" · ")}
          </small>
        )}
        {statutory.missing.length > 0 && (
          <small className="statutory-missing">
            Not configured: {statutory.missing.map((rule) => ruleLabels[rule] ?? rule).join(", ")}. These are shown as zero because no rule version exists, not because nothing is due.
          </small>
        )}
        <small>These are suggestions for review. Income tax / TDS is always entered manually. Verify every amount before submitting the run.</small>
      </div>
    )}
    <form action={action} key={suggestionKey}><input name="runId" type="hidden" value={runId} /><input name="employeeUserId" type="hidden" value={entry.employeeUserId} />
      <label><span>One-time addition</span><input defaultValue={money(entry.oneTimeAdditionPaise)} inputMode="decimal" name="oneTimeAddition" /></label>
      <label><span>One-time deduction</span><input defaultValue={money(entry.oneTimeDeductionPaise)} inputMode="decimal" name="oneTimeDeduction" /></label>
      <label><span>Employee PF</span><input defaultValue={money(applied && suggestion ? suggestion.employeeProvidentFundPaise : entry.employeeProvidentFundPaise)} inputMode="decimal" name="employeeProvidentFund" /></label>
      <label><span>Employee ESI</span><input defaultValue={money(applied && suggestion ? suggestion.employeeStateInsurancePaise : entry.employeeStateInsurancePaise)} inputMode="decimal" name="employeeStateInsurance" /></label>
      <label><span>Professional tax</span><input defaultValue={money(applied && suggestion ? suggestion.professionalTaxPaise : entry.professionalTaxPaise)} inputMode="decimal" name="professionalTax" /></label>
      <label><span>Income tax / TDS</span><input defaultValue={money(entry.incomeTaxPaise)} inputMode="decimal" name="incomeTax" /></label>
      <label className="payroll-hold-toggle"><input defaultChecked={entry.hold} name="hold" type="checkbox" /><span>Place this employee&apos;s payment on hold</span></label>
      <label className="payroll-entry-note"><span>Hold reason</span><textarea defaultValue={entry.holdReason} maxLength={500} name="holdReason" placeholder="Required while payment is on hold" /></label>
      <label className="payroll-entry-note"><span>Payroll note</span><textarea defaultValue={entry.note} maxLength={500} name="note" /></label>
      {state.error && <p className="client-form-banner" role="alert">{state.error}</p>}
      <button className="secondary-button" disabled={pending} type="submit">{pending ? "Recalculating..." : "Save & recalculate"}</button>
    </form>
  </details>;
}
