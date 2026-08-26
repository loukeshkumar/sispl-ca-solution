"use client";

import Link from "next/link";

import { EmployeeDialogButton } from "./employee-dialog";
import { useMemo, useState } from "react";

import { BENCH_RISK_LABELS, BENCH_RISK_NOTES, CAPABILITY_LABELS, QUALIFICATION_LABELS, type Qualification } from "../../lib/team/capability";
import type { CapabilityMatrix } from "../../lib/team/capability-repository";
import type { EmployeeSummary } from "../../lib/team/repository";
import { DashboardIcon } from "./dashboard-icons";
import { EmptyState, InitialsAvatar, KpiCard, PageTitle, StatusBadge } from "./dashboard-ui";

const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");

/** A short mark for a grid cell; the legend carries the full word. */
const CELL_MARK: Record<string, string> = { learning: "L", prepare: "P", review: "R", sign: "S" };

/**
 * Where the firm is one absence away from a problem.
 *
 * A service nobody can review cannot have work signed off on it, and a service
 * with one reviewer stops when that person is ill. Both are facts the firm
 * already owns and has never been able to see.
 */
function BenchPanel({ matrix }: { matrix: CapabilityMatrix }) {
  const exposed = matrix.bench.filter((row) => row.risk === "uncovered" || row.risk === "single_point");
  return (
    <section className="surface-card capability-bench-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">BENCH STRENGTH</p>
          <h2>Who can review what</h2>
          <span>{exposed.length ? `${exposed.length} of ${matrix.bench.length} services rest on one person or nobody` : `All ${matrix.bench.length} services have depth`}</span>
        </div>
      </div>

      {matrix.services.length === 0 ? (
        <EmptyState description="Add services to the firm's service master before recording who can deliver them." icon="services" title="No services defined" />
      ) : (
        <>
          <ul className="capability-bench-list">
            {matrix.bench.map((row) => (
              <li className={`capability-bench-row is-${row.risk}`} key={row.serviceCode}>
                <span><strong>{row.serviceName}</strong><small>{row.serviceCode}</small></span>
                <span><strong>{row.reviewers}</strong><small>can review</small></span>
                <span><strong>{row.capable}</strong><small>can prepare</small></span>
                <span><strong>{row.learning}</strong><small>learning</small></span>
                <StatusBadge tone={row.risk === "uncovered" ? "red" : row.risk === "single_point" ? "red" : row.risk === "thin" ? "amber" : "mint"}>
                  {BENCH_RISK_LABELS[row.risk]}
                </StatusBadge>
                <small className="capability-bench-note">{BENCH_RISK_NOTES[row.risk]}</small>
              </li>
            ))}
          </ul>

          <div className="capability-matrix-scroll">
            <table className="capability-matrix">
              <caption>Capability by person and service. L learning · P can prepare · R can review · S can sign.</caption>
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  {matrix.services.map((service) => <th key={service.code} scope="col" title={service.name}>{service.code}</th>)}
                </tr>
              </thead>
              <tbody>
                {matrix.members.map((member) => (
                  <tr key={member.userId}>
                    <th scope="row">
                      <strong>{member.fullName}</strong>
                      <small>{QUALIFICATION_LABELS[member.qualification as Qualification] ?? member.qualification}{member.membershipNumber ? ` · ${member.membershipNumber}` : ""}</small>
                    </th>
                    {matrix.services.map((service) => {
                      const level = member.levels[service.code];
                      return (
                        <td className={level ? `is-${level}` : "is-none"} key={service.code}>
                          <span title={level ? CAPABILITY_LABELS[level] : "Not rated"}>{level ? CELL_MARK[level] : "·"}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

export function TeamWorkspace({ canManage, capability, employees }: { canManage: boolean; capability: CapabilityMatrix; employees: EmployeeSummary[] }) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"Active" | "Needs attention" | "Disabled" | "All">("Active");
  const [role, setRole] = useState("all");
  const visible = useMemo(() => employees.filter((employee) => {
    const inScope = scope === "All" || (scope === "Active" ? employee.status === "active" : scope === "Disabled" ? employee.status === "disabled" : employee.overdueTaskCount > 0 || employee.mustChangePassword);
    const inRole = role === "all" || employee.roleName === role;
    return inScope && inRole && (!query || `${employee.fullName} ${employee.employeeCode} ${employee.designation} ${employee.email}`.toLowerCase().includes(query.toLowerCase()));
  }), [employees, query, role, scope]);
  const active = employees.filter((employee) => employee.status === "active");
  const available = active.filter((employee) => employee.activeTaskCount < 5).length;
  const overdue = employees.reduce((sum, employee) => sum + employee.overdueTaskCount, 0);
  const unassigned = active.filter((employee) => employee.activeTaskCount === 0).length;

  return (
    <div className="team-workspace">
      <PageTitle actions={canManage ? <EmployeeDialogButton><DashboardIcon name="plus" size={17} />Add employee</EmployeeDialogButton> : undefined} description="Manage firm roles, account readiness, capacity, and assigned delivery work." eyebrow="PEOPLE OPERATIONS" title="Employees" />
      <section aria-label="Team operations metrics" className="kpi-grid team-kpi-grid">
        <KpiCard icon="team" label="ACTIVE EMPLOYEES" note="Enabled firm members" tone="blue" value={String(active.length).padStart(2, "0")} />
        <KpiCard icon="review" label="AVAILABLE CAPACITY" note="Fewer than five open tasks" tone="mint" value={String(available).padStart(2, "0")} />
        <KpiCard icon="alert" label="OVERDUE ASSIGNMENTS" note="Across the active team" tone="red" value={String(overdue).padStart(2, "0")} />
        <KpiCard icon="work" label="UNASSIGNED CAPACITY" note="No active office tasks" tone="amber" value={String(unassigned).padStart(2, "0")} />
      </section>
      <section className="surface-card team-register-panel">
        <div className="panel-heading team-register-heading"><div><p className="eyebrow">EMPLOYEE DIRECTORY</p><h2>People and workload</h2><span>{visible.length} matching employees</span></div><label className="client-search"><DashboardIcon name="search" size={17} /><input aria-label="Search employees" onChange={(event) => setQuery(event.target.value)} placeholder="Search name, code or designation..." type="search" value={query} /></label></div>
        <div className="team-filter-bar"><div aria-label="Filter employees by status" className="segment-control team-filters">{(["Active", "Needs attention", "Disabled", "All"] as const).map((item) => <button aria-pressed={scope === item} key={item} onClick={() => setScope(item)} type="button">{item}</button>)}</div><label className="compact-select"><span>Role</span><select aria-label="Filter employees by role" onChange={(event) => setRole(event.target.value)} value={role}><option value="all">All roles</option>{[...new Set(employees.map((employee) => employee.roleName))].sort().map((name) => <option key={name} value={name}>{name}</option>)}</select></label></div>
        <div className="team-list-head" aria-hidden="true"><span>EMPLOYEE</span><span>ROLE</span><span>WORKLOAD</span><span>OVERDUE</span><span>ACCESS</span></div>
        <div className="team-register-list">
          {visible.map((employee) => <Link className="team-register-row" href={`/team/${employee.id}`} key={employee.id}><span className="team-identity"><InitialsAvatar initials={initials(employee.fullName)} /><span><strong>{employee.fullName}</strong><small>{employee.employeeCode} · {employee.designation}</small></span></span><span><strong>{employee.roleName}</strong><small>{employee.email}</small></span><span className="team-workload"><strong>{employee.activeTaskCount}</strong><small>active tasks</small><i><b style={{ width: `${Math.min(100, employee.activeTaskCount * 14)}%` }} /></i></span><span><strong className={employee.overdueTaskCount ? "text-danger" : ""}>{employee.overdueTaskCount}</strong><small>assignments</small></span><span><StatusBadge tone={employee.status !== "active" ? "red" : employee.mustChangePassword ? "amber" : employee.loginEnabled ? "mint" : "blue"}>{employee.status !== "active" ? "Disabled" : employee.mustChangePassword ? "Setup pending" : employee.loginEnabled ? "Access ready" : "No login"}</StatusBadge></span><DashboardIcon name="arrow" size={17} /></Link>)}
          {!visible.length && <EmptyState description="Clear the filter to see everyone in the firm." icon="team" title="No employees match this filter" />}
        </div>
      </section>
      <BenchPanel matrix={capability} />
    </div>
  );
}
