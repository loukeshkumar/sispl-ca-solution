import Link from "next/link";
import type { CSSProperties } from "react";

import type { CapacityLane } from "../../lib/work/queue";
import { workQueueHref, type WorkQueueParams } from "../../lib/work/queue-params";
import { EmptyState } from "./dashboard-ui";

const weekLabel = (weekStart: string) => new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${weekStart}T00:00:00Z`));

/**
 * Committed effort against configured availability, four weeks out. Clicking a
 * cell opens the same work filtered to that person, so the view both shows the
 * imbalance and offers the correction.
 */
export function WorkCapacityView({ lanes, params }: { lanes: CapacityLane[]; params: WorkQueueParams }) {
  if (!lanes.length) {
    return <EmptyState description="Capacity needs employees with an attendance work profile." icon="team" title="No capacity to show" />;
  }
  const weeks = lanes[0]!.weeks.map((week) => week.weekStart);
  return (
    <div className="work-capacity-scroll">
      <div className="work-capacity">
        <div className="work-capacity-head">
          <span>Team member</span>
          {weeks.map((week) => <span key={week}>w/c {weekLabel(week)}</span>)}
        </div>
        {lanes.map((lane) => (
          <div className="work-capacity-lane" key={lane.memberId}>
            <span className="work-capacity-name">{lane.memberName}</span>
            {lane.weeks.map((cell) => {
              const percentage = cell.availableMinutes > 0 ? Math.round((cell.loadMinutes / cell.availableMinutes) * 100) : 0;
              return (
                <Link
                  aria-label={`${lane.memberName}, week starting ${cell.weekStart}: ${percentage}% committed${cell.unbudgetedCount ? `, ${cell.unbudgetedCount} unbudgeted` : ""}`}
                  className={`work-capacity-cell${percentage > 100 ? " is-over" : percentage >= 80 ? " is-tight" : ""}`}
                  href={workQueueHref({ ...params, owner: lane.memberId, scope: "firm", view: "list" })}
                  key={cell.weekStart}
                >
                  <span className="work-capacity-bar" style={{ "--fill": `${Math.min(percentage, 100)}%` } as CSSProperties} />
                  <strong>{percentage}%</strong>
                  {/* An unbudgeted job contributes no minutes, so say so rather
                      than letting an empty-looking lane read as free. */}
                  {cell.unbudgetedCount > 0 && <em>+{cell.unbudgetedCount} unbudgeted</em>}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
