"use client";

import { useActionState, useState } from "react";

import { formatPaise } from "../../../lib/payroll/money";
import type { RateCard } from "../../../lib/rates/repository";
import { removeOverrideAction, saveOverrideAction, saveRateAction, type RateActionState } from "./actions";

const initialState: RateActionState = { error: "", fieldErrors: {} };

const formatDate = (value: string) => new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" })
  .format(new Date(`${value}T00:00:00Z`));

const perHour = (paise: number | null) => (paise === null ? "—" : `${formatPaise(paise)}/hr`);

/**
 * What an hour of this person earns the firm.
 *
 * Both halves are already on the row; not showing the difference left the
 * reader to do the subtraction on every line. Margin is only stated where both
 * sides are known — a missing cost is unknown margin, not zero margin.
 */
function marginOf(row: RateCard["rows"][number]) {
  if (row.chargePaisePerHour === null || row.costPaisePerHour === null) return null;
  const paise = row.chargePaisePerHour - row.costPaisePerHour;
  return { paise, share: row.chargePaisePerHour > 0 ? (paise / row.chargePaisePerHour) * 100 : 0 };
}

const COST_BASIS_NOTE: Record<RateCard["rows"][number]["costBasis"], string> = {
  payroll: "From the salary structure",
  rate_card: "Entered by hand",
  none: "No salary structure, no entry",
};

/**
 * The firm's rate card.
 *
 * Charge rates are typed; cost is read from the salary already on file, so the
 * two cannot drift into separate versions of the truth. The manual cost column
 * exists for the people payroll cannot answer for — a partner drawing no salary,
 * most often — and each row says which of the two it is using.
 */
export function RateCardEditor({ canManage, card }: { canManage: boolean; card: RateCard }) {
  const [rateState, saveRate, savingRate] = useActionState(saveRateAction, initialState);
  const [overrideState, saveOverride, savingOverride] = useActionState(saveOverrideAction, initialState);
  const [removeState, removeOverride, removing] = useActionState(removeOverrideAction, initialState);
  const [employeeUserId, setEmployeeUserId] = useState("");
  const [overrideEmployee, setOverrideEmployee] = useState("");
  const [legalEntityId, setLegalEntityId] = useState("");

  const error = rateState.error || overrideState.error || removeState.error;
  const unrated = card.rows.filter((row) => row.chargePaisePerHour === null);

  return (
    <>
      {error && <p className="package-form-banner" role="alert">{error}</p>}

      <section className="surface-card rate-card-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">STANDARD RATE CARD</p>
            <h2>What an hour is worth</h2>
            <span>
              {unrated.length
                ? `${unrated.length} of ${card.rows.length} people have no rate, so their billable time cannot be valued.`
                : `All ${card.rows.length} people are rated.`}
            </span>
          </div>
        </div>

        <div className="package-register-head rate-card-head">
          <span>Employee</span><span>Charge</span><span>Cost</span><span>Margin an hour</span><span>In force from</span><span>Client rates</span>
        </div>
        {card.rows.map((row) => (
          <article className={`package-register-row rate-card-row${row.chargePaisePerHour === null ? " is-unrated" : ""}`} key={row.employeeUserId}>
            <span><strong>{row.fullName}</strong><small>{row.designation}</small></span>
            <span>
              <strong>{perHour(row.chargePaisePerHour)}</strong>
              {row.chargePaisePerHour === null && <small>Billable time is not valued</small>}
            </span>
            <span><strong>{perHour(row.costPaisePerHour)}</strong><small>{COST_BASIS_NOTE[row.costBasis]}</small></span>
            <RateMargin row={row} />
            <span>{row.effectiveFrom ? formatDate(row.effectiveFrom) : "—"}</span>
            <span>{row.overrideCount ? `${row.overrideCount} negotiated` : "House rate only"}</span>
          </article>
        ))}

        {canManage && (
          <form action={saveRate} className="rate-form">
            <label>
              <span>Employee</span>
              <select name="employeeUserId" onChange={(event) => setEmployeeUserId(event.target.value)} required value={employeeUserId}>
                <option value="">Choose an employee</option>
                {card.rows.map((row) => <option key={row.employeeUserId} value={row.employeeUserId}>{row.fullName}</option>)}
              </select>
            </label>
            <label>
              <span>Charge per hour</span>
              <input inputMode="decimal" name="chargeRupees" placeholder="3500" required type="text" />
              {rateState.fieldErrors.chargeRupees && <small className="rate-field-error">{rateState.fieldErrors.chargeRupees}</small>}
            </label>
            <label>
              <span>Cost per hour</span>
              <input inputMode="decimal" name="costRupees" placeholder="Leave blank" type="text" />
              {rateState.fieldErrors.costRupees
                ? <small className="rate-field-error">{rateState.fieldErrors.costRupees}</small>
                : <small>Blank derives it from payroll, which is the better answer where there is one.</small>}
            </label>
            <label>
              <span>In force from</span>
              <input defaultValue={card.todayKey} name="effectiveFrom" required type="date" />
              <small>Earlier work keeps the rate that applied on the day.</small>
            </label>
            <label className="rate-form-wide">
              <span>Note (optional)</span>
              <input maxLength={300} name="note" placeholder="Why the rate changed" type="text" />
            </label>
            <button className="primary-button" disabled={savingRate || !employeeUserId} type="submit">
              {savingRate ? "Saving…" : "Set rate"}
            </button>
          </form>
        )}
      </section>

      <section className="surface-card rate-card-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">NEGOTIATED RATES</p>
            <h2>Exceptions by client</h2>
            <span>A rate agreed with one client, for one person. Everything else falls back to the house rate.</span>
          </div>
        </div>

        {card.overrides.length === 0 ? (
          <p className="rate-empty">No negotiated rates. Every client is billed at the standard card.</p>
        ) : (
          <>
            <div className="package-register-head rate-override-head">
              <span>Client</span><span>Employee</span><span>Rate</span><span>In force from</span><span aria-hidden="true" />
            </div>
            {card.overrides.map((row) => (
              <article className="package-register-row rate-override-row" key={row.id}>
                <span><strong>{row.clientName}</strong>{row.note && <small>{row.note}</small>}</span>
                <span>{row.employeeName}</span>
                <span><strong>{perHour(row.chargePaisePerHour)}</strong></span>
                <span>{formatDate(row.effectiveFrom)}</span>
                {canManage ? (
                  <form action={removeOverride}>
                    <input name="overrideId" type="hidden" value={row.id} />
                    <button className="rate-withdraw" disabled={removing} type="submit">Withdraw</button>
                  </form>
                ) : <span />}
              </article>
            ))}
          </>
        )}

        {canManage && (
          <form action={saveOverride} className="rate-form">
            <label>
              <span>Client</span>
              <select name="legalEntityId" onChange={(event) => setLegalEntityId(event.target.value)} required value={legalEntityId}>
                <option value="">Choose a client</option>
                {card.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
              </select>
            </label>
            <label>
              <span>Employee</span>
              <select name="employeeUserId" onChange={(event) => setOverrideEmployee(event.target.value)} required value={overrideEmployee}>
                <option value="">Choose an employee</option>
                {card.rows.map((row) => <option key={row.employeeUserId} value={row.employeeUserId}>{row.fullName}</option>)}
              </select>
            </label>
            <label>
              <span>Negotiated rate per hour</span>
              <input inputMode="decimal" name="chargeRupees" placeholder="2800" required type="text" />
              {overrideState.fieldErrors.chargeRupees && <small className="rate-field-error">{overrideState.fieldErrors.chargeRupees}</small>}
            </label>
            <label>
              <span>In force from</span>
              <input defaultValue={card.todayKey} name="effectiveFrom" required type="date" />
            </label>
            <label className="rate-form-wide">
              <span>Note (optional)</span>
              <input maxLength={300} name="note" placeholder="What was agreed, and with whom" type="text" />
            </label>
            <button className="primary-button" disabled={savingOverride || !legalEntityId || !overrideEmployee} type="submit">
              {savingOverride ? "Saving…" : "Record negotiated rate"}
            </button>
          </form>
        )}
      </section>
    </>
  );
}

/**
 * A loss-making rate is the one thing here worth colouring: everything else is
 * a number the reader judges for themselves against their own firm.
 */
function RateMargin({ row }: { row: RateCard["rows"][number] }) {
  const margin = marginOf(row);
  if (!margin) {
    return <span className="rate-margin is-unknown"><strong>—</strong><small>Cost unknown</small></span>;
  }
  return (
    <span className={`rate-margin${margin.paise < 0 ? " is-negative" : ""}`}>
      <strong>{formatPaise(margin.paise)}</strong>
      <small>{margin.paise < 0 ? "Charged below cost" : `${margin.share.toFixed(0)}% of the charge`}</small>
    </span>
  );
}
