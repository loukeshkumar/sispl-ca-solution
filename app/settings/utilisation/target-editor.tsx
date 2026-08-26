"use client";

import { useActionState, useState } from "react";

import { roleLabel } from "../../../lib/auth/authorization";
import type { UtilisationTargetView } from "../../../lib/rates/utilisation-repository";
import { removeTargetAction, saveTargetAction, type TargetActionState } from "./actions";

const initialState: TargetActionState = { error: "", fieldErrors: {} };

const ROLE_KEYS = ["partner", "manager", "associate", "firm_administrator"] as const;

const formatDate = (value: string) => new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" })
  .format(new Date(`${value}T00:00:00Z`));

const percent = (basisPoints: number) => `${(basisPoints / 100).toFixed(1)}%`;

/**
 * The targets utilisation is measured against.
 *
 * Set per role so a new joiner is measured from their first month without
 * anyone remembering to configure them, and overridden per person where
 * somebody's job genuinely differs from their grade.
 */
export function TargetEditor({
  canManage,
  employees,
  targets,
  todayKey,
}: {
  canManage: boolean;
  employees: Array<{ fullName: string; roleKey: string; userId: string }>;
  targets: UtilisationTargetView[];
  todayKey: string;
}) {
  const [saveState, save, saving] = useActionState(saveTargetAction, initialState);
  const [removeState, remove, removing] = useActionState(removeTargetAction, initialState);
  const [scope, setScope] = useState<"role" | "employee">("role");

  const error = saveState.error || removeState.error;
  const roleTargets = targets.filter((row) => row.scope === "role");
  const personTargets = targets.filter((row) => row.scope === "employee");
  const rolesWithout = ROLE_KEYS.filter((key) => !roleTargets.some((row) => row.roleKey === key));

  return (
    <>
      {error && <p className="package-form-banner" role="alert">{error}</p>}

      <section className="surface-card rate-card-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">TARGETS BY ROLE</p>
            <h2>What each grade is expected to sell</h2>
            <span>
              {rolesWithout.length
                ? `${rolesWithout.length} of ${ROLE_KEYS.length} roles have no target, so those people are not measured.`
                : "Every role has a target, so everybody is measured from their first month."}
            </span>
          </div>
        </div>

        {roleTargets.length === 0 ? (
          <p className="rate-empty">No role targets. Until one is set, utilisation is reported but not judged.</p>
        ) : (
          <>
            <div className="package-register-head target-head">
              <span>Role</span><span>Target</span><span>In force from</span><span>Note</span><span aria-hidden="true" />
            </div>
            {roleTargets.map((row) => (
              <article className="package-register-row target-row" key={row.id}>
                <span><strong>{roleLabel(row.roleKey ?? "")}</strong></span>
                <span><strong>{percent(row.targetBasisPoints)}</strong></span>
                <span>{formatDate(row.effectiveFrom)}</span>
                <span>{row.note || "—"}</span>
                {canManage ? (
                  <form action={remove}>
                    <input name="targetId" type="hidden" value={row.id} />
                    <button className="rate-withdraw" disabled={removing} type="submit">Withdraw</button>
                  </form>
                ) : <span />}
              </article>
            ))}
          </>
        )}
      </section>

      <section className="surface-card rate-card-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">PER-PERSON OVERRIDES</p>
            <h2>Where somebody&apos;s job differs from their grade</h2>
            <span>An override beats the role target. Everyone without one inherits their role&apos;s.</span>
          </div>
        </div>

        {personTargets.length === 0 ? (
          <p className="rate-empty">No overrides. Everybody is measured against their role.</p>
        ) : (
          <>
            <div className="package-register-head target-head">
              <span>Employee</span><span>Target</span><span>In force from</span><span>Note</span><span aria-hidden="true" />
            </div>
            {personTargets.map((row) => (
              <article className="package-register-row target-row" key={row.id}>
                <span><strong>{row.employeeName ?? "Former employee"}</strong></span>
                <span><strong>{percent(row.targetBasisPoints)}</strong></span>
                <span>{formatDate(row.effectiveFrom)}</span>
                <span>{row.note || "—"}</span>
                {canManage ? (
                  <form action={remove}>
                    <input name="targetId" type="hidden" value={row.id} />
                    <button className="rate-withdraw" disabled={removing} type="submit">Withdraw</button>
                  </form>
                ) : <span />}
              </article>
            ))}
          </>
        )}

        {canManage && (
          <form action={save} className="rate-form">
            <label>
              <span>Applies to</span>
              <select name="scope" onChange={(event) => setScope(event.target.value as "role" | "employee")} value={scope}>
                <option value="role">A role</option>
                <option value="employee">One person</option>
              </select>
            </label>
            {scope === "role" ? (
              <label>
                <span>Role</span>
                <select name="roleKey" required>
                  {ROLE_KEYS.map((key) => <option key={key} value={key}>{roleLabel(key)}</option>)}
                </select>
              </label>
            ) : (
              <label>
                <span>Employee</span>
                <select name="employeeUserId" required>
                  <option value="">Choose an employee</option>
                  {employees.map((person) => (
                    <option key={person.userId} value={person.userId}>{person.fullName} · {roleLabel(person.roleKey)}</option>
                  ))}
                </select>
              </label>
            )}
            <label>
              <span>Target</span>
              <input inputMode="decimal" name="targetPercent" placeholder="75" required type="text" />
              {saveState.fieldErrors.targetPercent
                ? <small className="rate-field-error">{saveState.fieldErrors.targetPercent}</small>
                : <small>Per cent of available time expected to be chargeable.</small>}
            </label>
            <label>
              <span>In force from</span>
              <input defaultValue={todayKey} name="effectiveFrom" required type="date" />
              <small>Earlier months keep the target that applied at the time.</small>
            </label>
            <label className="rate-form-wide">
              <span>Note (optional)</span>
              <input maxLength={300} name="note" placeholder="Why this target, and who agreed it" type="text" />
            </label>
            <button className="secondary-button" disabled={saving} type="submit">
              {saving ? "Saving…" : "Set target"}
            </button>
          </form>
        )}
      </section>
    </>
  );
}
