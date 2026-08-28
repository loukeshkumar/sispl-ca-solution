import { roleLabel } from "../../../lib/auth/authorization";
import type { FirmUtilisation, PersonUtilisation, UtilisationBand } from "../../../lib/rates/utilisation";

const percent = (basisPoints: number | null) => (basisPoints === null ? "—" : `${(basisPoints / 100).toFixed(1)}%`);

const bandCopy: Record<UtilisationBand, { label: string; tone: string }> = {
  over: { label: "Above target", tone: "is-over" },
  on_target: { label: "On target", tone: "is-on" },
  under: { label: "Under target", tone: "is-under" },
  unmeasured: { label: "No target", tone: "is-unmeasured" },
};

/** Under first: the rows worth reading are the ones that need a conversation. */
const bandOrder: Record<UtilisationBand, number> = { under: 0, on_target: 1, over: 2, unmeasured: 3 };

function signed(basisPoints: number | null) {
  if (basisPoints === null) return "—";
  const points = basisPoints / 100;
  return `${points > 0 ? "+" : ""}${points.toFixed(1)}`;
}

/**
 * What the targets above actually produced this month.
 *
 * The repository already resolves each person's target, their chargeable share
 * and the variance between them; without this the page could set a target and
 * never show whether anybody met it.
 */
export function Attainment({ periodKey, utilisation }: { periodKey: string; utilisation: FirmUtilisation | null }) {
  if (!utilisation || utilisation.people.length === 0) return null;

  const people = [...utilisation.people].sort((left, right) =>
    bandOrder[left.band] - bandOrder[right.band] || left.fullName.localeCompare(right.fullName));

  return (
    <section className="surface-card rate-card-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">AGAINST TARGET · {periodKey}</p>
          <h2>How the month is going</h2>
          <span>
            Chargeable time as a share of what each person had available, measured against the target that applies to
            them. Anything within 2.5 points of target counts as meeting it.
          </span>
        </div>
      </div>

      <div className="package-register-head attain-head">
        <span>Person</span><span>Target</span><span>Actual</span><span>Against target</span><span aria-hidden="true" />
      </div>

      {people.map((person) => <AttainmentRow key={person.employeeUserId} person={person} />)}
    </section>
  );
}

function AttainmentRow({ person }: { person: PersonUtilisation }) {
  const band = bandCopy[person.band];
  // Both bars are drawn against the same 100% scale, so the fill and the target
  // notch can be compared by eye down the column.
  const fill = person.utilisationBps === null ? 0 : Math.min(100, person.utilisationBps / 100);
  const marker = person.targetBasisPoints === null ? null : Math.min(100, person.targetBasisPoints / 100);

  return (
    <article className="package-register-row attain-row">
      <span>
        <strong>{person.fullName}</strong>
        <small>{roleLabel(person.roleKey)}{person.targetSource === "employee" ? " · own target" : ""}</small>
      </span>
      <span><strong>{percent(person.targetBasisPoints)}</strong></span>
      <span><strong>{percent(person.utilisationBps)}</strong></span>
      <span className={`attain-variance ${band.tone}`}>
        <b>{signed(person.varianceBps)}</b>
        <small>{band.label}</small>
      </span>
      <span aria-hidden="true" className={`attain-bar ${band.tone}`}>
        <i style={{ width: `${fill}%` }} />
        {marker !== null && <u style={{ left: `${marker}%` }} />}
      </span>
    </article>
  );
}
