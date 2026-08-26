"use client";

import { useActionState, useState } from "react";

import {
  lineSummary,
  needsWriteOffReason,
  realisationOf,
  realisationSummary,
} from "../../../lib/billing/time-billing";
import type { TimeDraft } from "../../../lib/billing/time-billing-repository";
import { StatusBadge } from "../../dashboard/dashboard-ui";
import { createFromTimeAction, type FromTimeActionState } from "./actions";

const initialState: FromTimeActionState = { error: "" };

const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * A draft invoice built from the time it is made of.
 *
 * Each line starts at what the time was worth and can be changed. What it was
 * worth stays on the screen beside it, because the whole point is that the
 * difference is visible while somebody is deciding, not discovered afterwards.
 */
export function DraftForm({ clientName, draft, legalEntityId, periodLabel }: {
  clientName: string;
  draft: TimeDraft;
  legalEntityId: string;
  periodLabel: string;
}) {
  const [state, submit, submitting] = useActionState(createFromTimeAction, initialState);
  const [amounts, setAmounts] = useState<Record<number, string>>(
    Object.fromEntries(draft.lines.map((line, index) => [index, (line.valuePaise / 100).toFixed(2)])),
  );

  const current = draft.lines.map((line, index) => ({
    amountPaise: Math.round(Number(amounts[index] ?? "0") * 100) || 0,
    valuePaise: line.valuePaise,
  }));
  const realisation = realisationOf(current);

  return (
    <form action={submit} className="surface-card from-time-form">
      <input name="legalEntityId" type="hidden" value={legalEntityId} />
      <input name="periodFrom" type="hidden" value={draft.periodFrom} />
      <input name="periodTo" type="hidden" value={draft.periodTo} />
      <input name="periodLabel" type="hidden" value={periodLabel} />

      <div className="panel-heading">
        <div>
          <p className="eyebrow">DRAFT FROM TIME</p>
          <h2>{clientName} · {periodLabel}</h2>
          <span>{realisationSummary(realisation, draft.totalMinutes)}</span>
        </div>
        {realisation.percent !== null && realisation.percent < 100 && (
          <StatusBadge tone="amber">{realisation.percent}% realised</StatusBadge>
        )}
      </div>

      {state.error && <p className="client-form-banner" role="alert">{state.error}</p>}

      {draft.unratedMinutes > 0 && (
        <p className="client-form-notice">
          {Math.floor(draft.unratedMinutes / 60)}h {String(draft.unratedMinutes % 60).padStart(2, "0")}m has no charge
          rate and contributes no value. Record a rate for those people if it should be billed.
        </p>
      )}

      <ul className="from-time-lines">
        {draft.lines.map((line, index) => {
          const amountPaise = current[index]!.amountPaise;
          const wantsReason = needsWriteOffReason({ amountPaise, valuePaise: line.valuePaise });
          const difference = amountPaise - line.valuePaise;
          return (
            <li className={`from-time-line${wantsReason ? " is-written" : ""}`} key={line.workItemId ?? `none-${index}`}>
              <input name="lineEntryIds" type="hidden" value={line.entryIds.join(",")} />
              <input name="lineDescription" type="hidden" value={line.description} />

              <div className="from-time-line-head">
                <strong>{line.description}</strong>
                <span>{lineSummary(line)}</span>
              </div>
              <div className="from-time-line-money">
                <span>worth {rupees(line.valuePaise)}</span>
                <label>
                  <span>Charge (₹)</span>
                  <input
                    min={0}
                    name="lineAmount"
                    onChange={(event) => setAmounts({ ...amounts, [index]: event.target.value })}
                    required
                    step="0.01"
                    type="number"
                    value={amounts[index] ?? ""}
                  />
                </label>
                {difference !== 0 && (
                  <em className={difference < 0 ? "is-down" : "is-up"}>
                    {difference < 0 ? "written down" : "written up"} {rupees(Math.abs(difference))}
                  </em>
                )}
              </div>
              {/* Only asked for where the departure is material. Nagging about
                  rounding teaches everybody to type "rounding". */}
              {wantsReason && (
                <label className="from-time-reason">
                  <span>Why</span>
                  <input
                    maxLength={500}
                    name="lineWriteOffReason"
                    placeholder="Fixed retainer covers this period"
                    required
                    type="text"
                  />
                </label>
              )}
              {!wantsReason && <input name="lineWriteOffReason" type="hidden" value="" />}
            </li>
          );
        })}
      </ul>

      <label className="from-time-notes">
        <span>Notes on the invoice</span>
        <input maxLength={2000} name="notes" type="text" />
      </label>

      <div className="from-time-total">
        <strong>{rupees(realisation.chargedPaise)}</strong>
        <button className="primary-button" disabled={submitting} type="submit">
          {submitting ? "Drafting…" : "Raise the draft"}
        </button>
      </div>
    </form>
  );
}
