"use client";

import { useActionState, useState } from "react";

import {
  KIND_CLEARS,
  KIND_LABELS,
  standingOf,
  waitingSummary,
  type DependencyKind,
} from "../../lib/dependencies/waiting";
import type { DependencyRow } from "../../lib/dependencies/repository";
import { StatusBadge } from "../dashboard/dashboard-ui";
import { clearDependencyAction, raiseDependencyAction, type DependencyActionState } from "./dependency-actions";

const initialState: DependencyActionState = { error: "", fieldErrors: {} };

const formatDate = (key: string) => new Intl.DateTimeFormat("en-IN", {
  day: "numeric", month: "short", timeZone: "Asia/Kolkata", year: "numeric",
}).format(new Date(`${key}T00:00:00+05:30`));

export type DependencyTargets = {
  /** Open document requests for this client, raisable as a dependency. */
  requests: Array<{ id: string; label: string }>;
  /** Other open obligations for this client that could come first. */
  predecessors: Array<{ id: string; label: string }>;
};

/**
 * What the work is waiting on, as a list rather than a sentence.
 *
 * The blocker note is still here and still free text — it is useful for colour
 * ("Ramesh says the CA sends it Fridays"). What it is no longer is the record.
 */
export function DependencyPanel({
  canWrite,
  completed,
  dependencies,
  targets,
  todayKey,
  workItemId,
}: {
  canWrite: boolean;
  completed: boolean;
  dependencies: DependencyRow[];
  targets: DependencyTargets;
  todayKey: string;
  workItemId: string;
}) {
  const [raiseState, raise, raising] = useActionState(raiseDependencyAction, initialState);
  const [clearState, clear, clearing] = useActionState(clearDependencyAction, initialState);
  const [kind, setKind] = useState<DependencyKind>("client_request");
  const [adding, setAdding] = useState(false);

  const standing = standingOf(dependencies, todayKey);
  const overdueIds = new Set(standing.overdue.map((entry) => entry.id));
  const error = raiseState.error || clearState.error;
  const ordered = [...dependencies].sort((left, right) => {
    if ((left.clearedAt === null) !== (right.clearedAt === null)) return left.clearedAt === null ? -1 : 1;
    return left.expectedOn.localeCompare(right.expectedOn);
  });

  return (
    <section className="surface-card dependency-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">WAITING ON</p>
          <h2>{waitingSummary(standing, formatDate)}</h2>
          <span>
            {standing.open.length > 0
              ? "A client deliverable clears when the document arrives. Predecessor work clears when it completes."
              : standing.settled
                ? `Everything recorded against this obligation has arrived — ${standing.cleared} in all.`
                : "Record what this obligation waits on, and it stops being a sentence somebody has to remember."}
          </span>
        </div>
        {/* Only where the badge says something the heading does not. */}
        {standing.overdue.length > 0 && <StatusBadge tone="red">{standing.overdue.length} overdue</StatusBadge>}
      </div>

      {error && <p className="client-form-banner" role="alert">{error}</p>}

      {ordered.length > 0 && (
        <ul className="dependency-list">
          {ordered.map((dependency) => (
            <li className={`dependency-row is-${dependency.clearedAt ? "cleared" : overdueIds.has(dependency.id) ? "overdue" : "open"}`} key={dependency.id}>
              <div className="dependency-row-head">
                <strong>{dependency.title}</strong>
                <span className="dependency-kind">{KIND_LABELS[dependency.kind]}</span>
              </div>
              <small className="dependency-row-line">
                {dependency.kind === "external" ? `${dependency.externalParty} · ` : ""}
                {dependency.clearedAt
                  ? `Cleared by ${dependency.clearedByName}${dependency.clearanceNote ? ` · ${dependency.clearanceNote}` : ""}`
                  : `Expected ${formatDate(dependency.expectedOn)}${overdueIds.has(dependency.id) ? " · overdue" : ""}`}
              </small>
              {!dependency.clearedAt && (
                <small className="dependency-row-clears">
                  {dependency.kind === "work_item" && dependency.predecessorStatus
                    ? `That obligation is ${dependency.predecessorStatus.replace("_", " ")}. ${KIND_CLEARS[dependency.kind]}.`
                    : `${KIND_CLEARS[dependency.kind]}.`}
                </small>
              )}
              {canWrite && !completed && !dependency.clearedAt && dependency.kind === "external" && (
                <form action={clear} className="dependency-clear-form">
                  <input name="dependencyId" type="hidden" value={dependency.id} />
                  <input maxLength={500} name="note" placeholder="What arrived" type="text" />
                  <button className="secondary-button" disabled={clearing} type="submit">Mark arrived</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {canWrite && !completed && (adding ? (
        <form action={raise} className="dependency-raise-form">
          <input name="workItemId" type="hidden" value={workItemId} />
          <label>
            <span>What kind of thing</span>
            <select name="kind" onChange={(event) => setKind(event.target.value as DependencyKind)} value={kind}>
              <option value="client_request">Client deliverable</option>
              <option value="work_item">Predecessor work</option>
              <option value="external">External party</option>
            </select>
          </label>

          {kind === "client_request" && (
            <label>
              <span>Which request</span>
              <select name="documentRequestId" required>
                <option value="">Choose an open request</option>
                {targets.requests.map((request) => <option key={request.id} value={request.id}>{request.label}</option>)}
              </select>
              {targets.requests.length === 0 && <small>No open requests for this client. Raise one in Documents first.</small>}
            </label>
          )}

          {kind === "work_item" && (
            <label>
              <span>Which obligation comes first</span>
              <select name="dependsOnWorkItemId" required>
                <option value="">Choose an obligation</option>
                {targets.predecessors.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
              {targets.predecessors.length === 0 && <small>No other open obligations for this client.</small>}
            </label>
          )}

          {kind === "external" && (
            <label>
              <span>Who owes it</span>
              <input maxLength={120} name="externalParty" placeholder="HDFC Bank · the previous auditor · the portal" required type="text" />
            </label>
          )}

          <label>
            <span>What is awaited</span>
            <input maxLength={200} minLength={3} name="title" placeholder="Bank statement — Nov 2026" required type="text" />
          </label>
          <label>
            <span>Expected by</span>
            <input name="expectedOn" required type="date" />
          </label>

          <div className="dependency-raise-buttons">
            <button className="primary-button" disabled={raising} type="submit">{raising ? "Recording…" : "Record dependency"}</button>
            <button className="secondary-button" onClick={() => setAdding(false)} type="button">Cancel</button>
          </div>
        </form>
      ) : (
        <button className="secondary-button" onClick={() => setAdding(true)} type="button">Record something this waits on</button>
      ))}
    </section>
  );
}
