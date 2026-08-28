import type { EmployeeActivityEntry } from "../../../lib/team/repository";
import { EmptyState } from "../../dashboard/dashboard-ui";

/**
 * What each audit action means to a reader.
 *
 * The stored action is a machine key; a record nobody can read is not much of
 * a record. Anything unrecognised falls back to the key itself rather than
 * being hidden, so a new action never silently disappears from the history.
 */
const ACTION_COPY: Record<string, { label: string; tone: string }> = {
  "admin.created": { label: "Admin account created", tone: "is-created" },
  "employee.created": { label: "Employee added", tone: "is-created" },
  "employee.updated": { label: "Profile updated", tone: "is-neutral" },
  "employee.role_changed": { label: "Access role changed", tone: "is-access" },
  "employee.access_provisioned": { label: "Temporary password issued", tone: "is-access" },
  "employee.password_expired": { label: "Password change forced", tone: "is-access" },
  "employee.disabled": { label: "Account disabled", tone: "is-exit" },
  "employee.exit_clearance_override": { label: "Exit clearance overridden", tone: "is-exit" },
  "employee.probation": { label: "Moved to probation", tone: "is-stage" },
  "employee.confirmed": { label: "Employment confirmed", tone: "is-stage" },
  "employee.notice": { label: "Notice period started", tone: "is-stage" },
  "employee.exited": { label: "Employment ended", tone: "is-exit" },
};

const stamp = (value: Date) => new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
}).format(value);

/**
 * `reason` holds either a sentence somebody typed or a JSON blob the mutation
 * recorded. Only the sentence is worth showing; the blob is for auditors
 * reading the table, not for this page.
 */
function readableReason(reason: string | null) {
  if (!reason) return null;
  const trimmed = reason.trim();
  if (!trimmed.startsWith("{")) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const name = parsed.afterRoleName ?? parsed.roleName;
    return typeof name === "string" ? name : null;
  } catch {
    return null;
  }
}

export function ActivityTimeline({ entries }: { entries: EmployeeActivityEntry[] }) {
  return (
    <section className="employee-activity">
      <div className="employee-overview-heading">
        <div>
          <p className="eyebrow">HISTORY</p>
          <h2>What has been done to this record</h2>
        </div>
        <span>{entries.length ? `${entries.length} event${entries.length === 1 ? "" : "s"}` : ""}</span>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          description="Changes to this employee's profile, access and employment stage are recorded here as they happen."
          icon="review"
          title="Nothing recorded yet"
        />
      ) : (
        <ol className="activity-list">
          {entries.map((entry) => {
            const copy = ACTION_COPY[entry.action] ?? { label: entry.action, tone: "is-neutral" };
            const reason = readableReason(entry.reason);
            return (
              <li className={`activity-entry ${copy.tone}`} key={entry.id}>
                <span aria-hidden="true" className="activity-marker" />
                <div>
                  <strong>{copy.label}</strong>
                  {reason && <em>{reason}</em>}
                  <small>{stamp(entry.occurredAt)}{entry.actorName ? ` · ${entry.actorName}` : " · system"}</small>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
