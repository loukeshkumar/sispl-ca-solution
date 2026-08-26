"use client";

import { useActionState, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import type { SalaryStructureLineInput } from "../../lib/payroll/validation";
import { createSalaryStructureAction, type SalaryActionState } from "./actions";

type EditableLine = Omit<SalaryStructureLineInput, "monthlyAmountPaise"> & { monthlyAmount: string };
const initialState: SalaryActionState = { error: "", fieldErrors: {} };
const emptyLine = (): EditableLine => ({ code: "", kind: "earning", label: "", monthlyAmount: "" });

export function SalaryStructureForm({ employeeUserId, minimumEffectiveDate, initialLines = [] }: {
  employeeUserId: string; minimumEffectiveDate?: string; initialLines?: SalaryStructureLineInput[];
}) {
  const [state, action, pending] = useActionState(createSalaryStructureAction, initialState);
  const [lines, setLines] = useState<EditableLine[]>(initialLines.length ? initialLines.map((line) => ({
    code: line.code, kind: line.kind, label: line.label, monthlyAmount: (line.monthlyAmountPaise / 100).toFixed(2),
  })) : [emptyLine()]);
  const update = (index: number, patch: Partial<EditableLine>) => setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  const serializedLines = JSON.stringify(lines.map((line) => ({ ...line, monthlyAmount: line.monthlyAmount })));

  return <form action={action} className="salary-structure-form">
    <input name="employeeUserId" type="hidden" value={employeeUserId} />
    <input name="lines" type="hidden" value={serializedLines} />
    <label><span>Effective from</span><input aria-describedby={state.fieldErrors.effectiveFrom ? "salary-effective-error" : undefined} min={minimumEffectiveDate} name="effectiveFrom" required type="date" />{state.fieldErrors.effectiveFrom && <small id="salary-effective-error">{state.fieldErrors.effectiveFrom}</small>}</label>
    <div className="salary-component-heading"><div><strong>Salary components</strong><span>Monthly INR amounts. Statutory deductions are entered during payroll.</span></div><button className="secondary-button" onClick={() => setLines((current) => [...current, emptyLine()])} type="button"><Plus aria-hidden="true" /> Add component</button></div>
    <div aria-describedby={state.fieldErrors.lines ? "salary-lines-error" : undefined} className="salary-component-list">
      {lines.map((line, index) => <div className="salary-component-row" key={`${index}-${line.code}`}>
        <label><span>Code</span><input maxLength={30} onChange={(event) => update(index, { code: event.target.value.toUpperCase() })} placeholder="BASIC" required value={line.code} /></label>
        <label><span>Label</span><input maxLength={80} onChange={(event) => update(index, { label: event.target.value })} placeholder="Basic salary" required value={line.label} /></label>
        <label><span>Type</span><select onChange={(event) => update(index, { kind: event.target.value as EditableLine["kind"] })} value={line.kind}><option value="earning">Earning</option><option value="deduction">Recurring deduction</option><option value="employer_contribution">Employer contribution</option></select></label>
        <label><span>Monthly amount</span><input inputMode="decimal" onChange={(event) => update(index, { monthlyAmount: event.target.value })} placeholder="0.00" required value={line.monthlyAmount} /></label>
        <button aria-label={`Remove ${line.label || `component ${index + 1}`}`} className="icon-button" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))} type="button"><Trash2 aria-hidden="true" /></button>
      </div>)}
    </div>
    {state.fieldErrors.lines && <p id="salary-lines-error" role="alert">{state.fieldErrors.lines}</p>}
    {state.error && <p className="client-form-banner" role="alert">{state.error}</p>}
    <div className="form-actions"><button className="primary-button" disabled={pending} type="submit">{pending ? "Saving salary..." : "Save salary version"}</button></div>
  </form>;
}
