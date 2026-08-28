"use client";

import { KeyRound, Search, ShieldAlert, TimerReset } from "lucide-react";
import { useActionState, useMemo, useState } from "react";

import { accessClassLabel } from "../../lib/auth/authorization";
import type { RoleMember } from "../../lib/roles/repository";
import type { MemberAccessState } from "../../lib/roles/validation";
import { expireMemberPasswordAction, resetMemberPasswordAction } from "../settings/roles/actions";
import { StatusBadge } from "./dashboard-ui";

const initialState: MemberAccessState = { error: "" };

/** Where a person's access stands, read from what the credential row says. */
function accessState(member: RoleMember) {
  if (!member.loginEnabled) return { label: "No login", tone: "blue" as const };
  if (member.mustChangePassword) return { label: "Change pending", tone: "amber" as const };
  return { label: "Access ready", tone: "mint" as const };
}

/**
 * The people behind the roles.
 *
 * The registers above answer "what does this role allow"; this one answers "who
 * holds it, and can they get in" — the question an administrator actually
 * arrives with when somebody has lost a password.
 */
export function RoleMembers({ canManage, people }: { canManage: boolean; people: RoleMember[] }) {
  const [query, setQuery] = useState("");
  const term = query.trim().toLowerCase();
  const visible = useMemo(
    () => (term ? people.filter((person) => `${person.fullName} ${person.email} ${person.roleName}`.toLowerCase().includes(term)) : people),
    [people, term],
  );

  return (
    <section className="surface-card role-members-card">
      <header>
        <span><KeyRound aria-hidden="true" /></span>
        <div>
          <p className="eyebrow">ASSIGNED ACCOUNTS</p>
          <h2>People and access</h2>
          <p>Every active membership, the role it carries, and whether the person can sign in.</p>
        </div>
        <label className="role-members-search">
          <Search aria-hidden="true" />
          <input
            aria-label="Filter people"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by name, email, or role…"
            type="search"
            value={query}
          />
        </label>
      </header>

      <div className="role-members-list">
        {visible.map((person) => {
          const state = accessState(person);
          return (
            <article key={person.membershipId}>
              <div className="role-member-identity">
                <strong>{person.fullName}</strong>
                <small>{person.email}</small>
              </div>
              <div className="role-member-role">
                <strong>{person.roleName}</strong>
                <small>{accessClassLabel(person.accessClass)}</small>
              </div>
              <StatusBadge tone={state.tone}>{state.label}</StatusBadge>
              {canManage && <MemberAccessActions member={person} />}
            </article>
          );
        })}
        {!visible.length && (
          <p className="role-members-empty">
            {term ? `Nobody matches “${query.trim()}”.` : "No active memberships in this firm."}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * Both acts are refused for a Super Admin and for an account with no employee
 * profile behind it, so the buttons are not offered where they cannot work.
 */
function MemberAccessActions({ member }: { member: RoleMember }) {
  const protectedAccount = member.accessClass === "super_admin" || !member.employeeId;
  const employeeId = member.employeeId ?? "";
  const [resetState, reset, resetting] = useActionState(resetMemberPasswordAction.bind(null, employeeId), initialState);
  const [expireState, expire, expiring] = useActionState(expireMemberPasswordAction.bind(null, employeeId), initialState);
  const [copied, setCopied] = useState(false);
  const error = resetState.error || expireState.error;

  if (protectedAccount) {
    return (
      <span className="role-member-protected">
        <ShieldAlert aria-hidden="true" />
        {member.accessClass === "super_admin" ? "Protected" : "No employee record"}
      </span>
    );
  }

  return (
    <div className="role-member-actions">
      <form action={reset}>
        <button className="master-toggle-button" disabled={resetting || expiring} type="submit">
          <KeyRound aria-hidden="true" />{resetting ? "Resetting…" : "Reset password"}
        </button>
      </form>
      <form action={expire}>
        <button className="master-toggle-button" disabled={resetting || expiring || !member.loginEnabled} type="submit">
          <TimerReset aria-hidden="true" />{expiring ? "Expiring…" : "Force change"}
        </button>
      </form>
      {error && <p className="role-member-error" role="alert">{error}</p>}
      {expireState.expired && !error && (
        <p className="role-member-note" role="status">Sessions revoked. A new password is required at the next sign-in.</p>
      )}
      {resetState.temporaryPassword && (
        <div aria-live="polite" className="temporary-password-panel role-member-password">
          <span>One-time temporary password</span>
          <code>{resetState.temporaryPassword}</code>
          <button
            className="secondary-button"
            onClick={() => {
              navigator.clipboard?.writeText(resetState.temporaryPassword ?? "").then(() => setCopied(true)).catch(() => setCopied(false));
            }}
            type="button"
          >
            {copied ? "Copied" : "Copy password"}
          </button>
          <small>Share it securely. It is not shown again, and it must be replaced at the next sign-in.</small>
        </div>
      )}
    </div>
  );
}
