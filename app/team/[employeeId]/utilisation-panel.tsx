import type { PersonUtilisation, UtilisationBand } from "../../../lib/rates/utilisation";
import { EmptyState } from "../../dashboard/dashboard-ui";

const percent = (basisPoints: number | null) => (basisPoints === null ? "—" : `${(basisPoints / 100).toFixed(1)}%`);
const hours = (minutes: number) => `${Math.round(minutes / 6) / 10}h`;

const BAND_COPY: Record<UtilisationBand, { label: string; tone: string }> = {
  over: { label: "Above target", tone: "is-over" },
  on_target: { label: "On target", tone: "is-on" },
  under: { label: "Under target", tone: "is-under" },
  unmeasured: { label: "No target set", tone: "is-unmeasured" },
};

/**
 * How this person's month is going against their own target.
 *
 * The same figures the utilisation settings page reports for the firm, read
 * for one person: whether the chargeable share met the target that applies to
 * them, and — separately — whether the timesheet was filled in at all, because
 * a low figure caused by missing entries is a different problem from a low
 * figure caused by the work.
 */
export function UtilisationPanel({ periodKey, person }: { periodKey: string; person: PersonUtilisation | null }) {
  return (
    <section className="employee-utilisation">
      <div className="employee-overview-heading">
        <div>
          <p className="eyebrow">UTILISATION · {periodKey}</p>
          <h2>Chargeable against target</h2>
        </div>
        {person && <span className={`utilisation-band ${BAND_COPY[person.band].tone}`}>{BAND_COPY[person.band].label}</span>}
      </div>

      {!person ? (
        <EmptyState
          description="Utilisation appears once this employee has scheduled time in the current month."
          icon="clock"
          title="Nothing measured this month"
        />
      ) : (
        <>
          <dl className="utilisation-figures">
            <div>
              <dt>Chargeable</dt>
              <dd>{percent(person.utilisationBps)}</dd>
              <span>{hours(person.chargeableMinutes)} of {hours(person.availableMinutes)} available</span>
            </div>
            <div>
              <dt>Target</dt>
              <dd>{percent(person.targetBasisPoints)}</dd>
              <span>{person.targetSource === "employee" ? "Their own target" : person.targetSource === "role" ? "From their role" : "No target applies"}</span>
            </div>
            <div>
              <dt>Against target</dt>
              <dd className={BAND_COPY[person.band].tone}>
                {person.varianceBps === null ? "—" : `${person.varianceBps > 0 ? "+" : ""}${(person.varianceBps / 100).toFixed(1)}`}
              </dd>
              <span>Percentage points</span>
            </div>
            <div>
              <dt>Timesheet</dt>
              <dd>{percent(person.recordingBps)}</dd>
              <span>{person.missingMinutes > 0 ? `${hours(person.missingMinutes)} unrecorded` : "Fully recorded"}</span>
            </div>
          </dl>

          {person.missingMinutes > 0 && (
            <p className="utilisation-caveat" role="note">
              {hours(person.missingMinutes)} of scheduled time has no timesheet against it, so the chargeable share
              above is measured on an incomplete record.
            </p>
          )}
        </>
      )}
    </section>
  );
}
