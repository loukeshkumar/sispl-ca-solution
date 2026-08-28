import type { LeaveBalance } from "../../../lib/attendance/leave-ledger-repository";
import { EmptyState } from "../../dashboard/dashboard-ui";

/** The ledger counts in half-days; people talk in days. */
const days = (halfDays: number) => {
  const value = halfDays / 2;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
};

/**
 * This employee's leave, type by type.
 *
 * The entitlement was already computed for the attendance workspace but only
 * ever for the signed-in viewer, so a manager looking at somebody's record
 * could see two attendance counters and nothing about what leave they have
 * left — the question actually asked before approving a request.
 */
export function LeaveEntitlement({ balances, leaveYear }: { balances: LeaveBalance[]; leaveYear: string | null }) {
  return (
    <section className="leave-entitlement">
      <div className="employee-overview-heading">
        <div>
          <p className="eyebrow">LEAVE ENTITLEMENT</p>
          <h2>What is left to take</h2>
        </div>
        {leaveYear && <span>Leave year {leaveYear}</span>}
      </div>

      {balances.length === 0 ? (
        <EmptyState
          description="Leave entitlement appears once this employee has a joining date and the firm has active leave types."
          icon="calendar"
          title="No entitlement recorded"
        />
      ) : (
        <ul className="leave-balance-list">
          {balances.map((balance) => {
            const entitled = balance.accruedHalfDays + balance.carriedHalfDays;
            // An uncapped or on-request type has no denominator to fill, so it
            // shows what has been taken rather than a share of nothing.
            const measurable = balance.capped && !balance.grantedOnRequest && entitled > 0;
            const used = measurable ? Math.min(100, (balance.takenHalfDays / entitled) * 100) : 0;
            const low = measurable && balance.balanceHalfDays <= 0;

            return (
              <li className={`leave-balance${low ? " is-spent" : ""}`} key={balance.code}>
                <span className="leave-balance-name">
                  <strong>{balance.name}</strong>
                  <small>{balance.code}{balance.carriedHalfDays > 0 ? ` · ${days(balance.carriedHalfDays)} carried in` : ""}</small>
                </span>
                <span className="leave-balance-figure">
                  <strong>{days(balance.balanceHalfDays)}</strong>
                  <small>days left</small>
                </span>
                <span className="leave-balance-detail">
                  {balance.grantedOnRequest
                    ? <small>Sanctioned per occasion · {days(balance.takenHalfDays)} taken</small>
                    : !balance.capped
                      ? <small>No annual limit · {days(balance.takenHalfDays)} taken</small>
                      : <small>{days(balance.takenHalfDays)} of {days(entitled)} days taken</small>}
                  {measurable && (
                    <span aria-hidden="true" className="leave-balance-bar">
                      <i style={{ width: `${used}%` }} />
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
