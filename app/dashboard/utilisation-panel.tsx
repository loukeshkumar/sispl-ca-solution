"use client";

import { formatMinutes } from "../../lib/timesheets/validation";
import {
  BAND_LABELS,
  BAND_NOTES,
  type FirmUtilisation,
  type UtilisationBand,
} from "../../lib/rates/utilisation";
import { EmptyState, StatusBadge } from "./dashboard-ui";

const percent = (basisPoints: number | null) => (basisPoints === null ? "—" : `${(basisPoints / 100).toFixed(1)}%`);

const variance = (basisPoints: number | null) => {
  if (basisPoints === null) return "";
  const points = basisPoints / 100;
  return `${points >= 0 ? "+" : ""}${points.toFixed(1)} pts`;
};

const BAND_TONE: Record<UtilisationBand, "red" | "amber" | "mint" | "blue" | "neutral"> = {
  unmeasured: "neutral",
  under: "amber",
  on_target: "mint",
  // Sustained overload is not a success, so it is not green.
  over: "blue",
};

/**
 * Utilisation against the target the firm set.
 *
 * This replaces a measure that compared everyone to the team median, which went
 * quiet in exactly the case that mattered most: a team where nobody records
 * their time has a healthy median and no usable numbers at all. So unrecorded
 * time is shown next to utilisation rather than behind it — until the timesheets
 * are in, the utilisation column is a guess.
 */
export function UtilisationPanel({ periodKey, utilisation }: { periodKey: string; utilisation: FirmUtilisation }) {
  if (utilisation.people.length === 0) {
    return (
      <section className="surface-card utilisation-panel">
        <EmptyState description="Utilisation appears once the firm has active employees with a working calendar." icon="team" title="Nothing to measure yet" />
      </section>
    );
  }

  return (
    <section className="surface-card utilisation-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">UTILISATION</p>
          <h2>Chargeable time against target</h2>
          <span>
            {percent(utilisation.utilisationBps)} across the firm for {periodKey}
            {utilisation.missingTimesheets > 0 && ` · ${utilisation.missingTimesheets} timesheet${utilisation.missingTimesheets === 1 ? "" : "s"} substantially unfilled`}
            {utilisation.unmeasured > 0 && ` · ${utilisation.unmeasured} without a target`}
          </span>
        </div>
      </div>

      {utilisation.missingTimesheets > 0 && (
        <p className="utilisation-caveat" role="status">
          Utilisation, engagement cost and unbilled value are all understated while time is unrecorded.
        </p>
      )}

      <div className="package-register-head utilisation-head">
        <span>Employee</span><span>Available</span><span>Recorded</span><span>Chargeable</span>
        <span>Utilisation</span><span>Target</span><span>Standing</span>
      </div>
      {utilisation.people.map((person) => (
        <article className={`package-register-row utilisation-row is-${person.band}`} key={person.employeeUserId}>
          <span>
            <strong>{person.fullName}</strong>
            <small>
              {person.leaveMinutes > 0
                ? `${formatMinutes(person.scheduledMinutes)} scheduled · ${formatMinutes(person.leaveMinutes)} leave`
                : `${formatMinutes(person.scheduledMinutes)} scheduled`}
            </small>
          </span>
          <span><strong>{formatMinutes(person.availableMinutes)}</strong></span>
          <span>
            <strong>{formatMinutes(person.recordedMinutes)}</strong>
            {person.missingMinutes > 0 && <small className="utilisation-missing">{formatMinutes(person.missingMinutes)} unrecorded</small>}
          </span>
          <span><strong>{formatMinutes(person.chargeableMinutes)}</strong></span>
          <span><strong className="utilisation-figure">{percent(person.utilisationBps)}</strong></span>
          <span>
            <strong>{percent(person.targetBasisPoints)}</strong>
            <small>{person.targetSource === "employee" ? "Own target" : person.targetSource === "role" ? "From role" : "Not set"}</small>
          </span>
          <span className="utilisation-standing">
            <StatusBadge tone={BAND_TONE[person.band]}>{BAND_LABELS[person.band]}</StatusBadge>
            {person.varianceBps !== null && <small>{variance(person.varianceBps)}</small>}
          </span>
        </article>
      ))}
      <p className="package-control-note-text">
        Available time is the working calendar less public holidays and approved leave. {BAND_NOTES.over}
      </p>
    </section>
  );
}
