import Link from "next/link";

import type { EmployeeCompliance } from "../../../lib/registers/repository";
import type { MemberStanding } from "../../../lib/training/repository";

const formatDate = (value: string) => new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "UTC" })
  .format(new Date(`${value}T00:00:00Z`));

const hours = (minutes: number) => `${Math.round(minutes / 6) / 10}h`;

/**
 * The statutory side of an employee: what they hold, what they signed, and
 * whether their CPE obligation is met.
 *
 * All three already existed — in the registers and the training log — and none
 * of them was reachable from the record of the person they belong to. The
 * custody list matters most when somebody is leaving, which is exactly when
 * nobody wants to go looking through three registers.
 */
export function CompliancePanel({
  compliance,
  standing,
  todayKey,
}: {
  compliance: EmployeeCompliance;
  standing: MemberStanding | null;
  todayKey: string;
}) {
  const expiring = compliance.dscHeld.filter((item) => item.validUntil <= todayKey);

  return (
    <section className="employee-compliance">
      <div className="employee-overview-heading">
        <div>
          <p className="eyebrow">STATUTORY RECORD</p>
          <h2>What this person holds and signs</h2>
        </div>
        <Link href="/?workspace=registers">Open registers</Link>
      </div>

      <dl className="compliance-figures">
        <div>
          <dt>Signing devices held</dt>
          <dd className={compliance.dscHeld.length ? "is-attention" : ""}>{compliance.dscHeld.length}</dd>
          <span>{expiring.length ? `${expiring.length} already expired` : "In custody right now"}</span>
        </div>
        <div>
          <dt>UDINs signed</dt>
          <dd>{compliance.udinCount}</dd>
          <span>{compliance.udinLatest ? `Latest ${formatDate(compliance.udinLatest)}` : "None issued"}</span>
        </div>
        <div>
          <dt>UDINs revoked</dt>
          <dd className={compliance.udinRevoked ? "is-attention" : ""}>{compliance.udinRevoked}</dd>
          <span>{compliance.udinRevoked ? "Withdrawn after issue" : "None withdrawn"}</span>
        </div>
        <div>
          <dt>CPE this block</dt>
          <dd className={standing?.standing && !standing.standing.block.compliant ? "is-attention" : ""}>
            {standing?.standing ? hours(standing.standing.block.totalMinutes) : "—"}
          </dd>
          <span>
            {!standing
              ? "Not on file"
              : standing.standing
                ? `of ${hours(standing.standing.block.totalRequiredMinutes)} required · ${standing.standing.blockLabel}`
                : `No obligation · ${hours(standing.totalLoggedMinutes)} logged`}
          </span>
        </div>
      </dl>

      {compliance.dscHeld.length > 0 && (
        <ul className="compliance-custody">
          {compliance.dscHeld.map((item) => (
            <li className={item.validUntil <= todayKey ? "is-expired" : ""} key={item.id}>
              <span>
                <strong>{item.certificateName}</strong>
                <small>{item.clientName}</small>
              </span>
              <small>{item.validUntil <= todayKey ? "Expired " : "Valid to "}{formatDate(item.validUntil)}</small>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
