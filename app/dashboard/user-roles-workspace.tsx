"use client";

import { ArrowRight, Crown, KeyRound, LockKeyhole, ShieldCheck, UserCog, UsersRound } from "lucide-react";
import { useState, type ReactNode } from "react";

import { accessClassLabel } from "../../lib/auth/authorization";
import type { RoleManagementWorkspace as RoleWorkspaceData } from "../../lib/roles/repository";
import type { ManagedRoleWithPermissions } from "../../lib/roles/repository";
import { KpiCard, PageTitle, StatusBadge } from "./dashboard-ui";
import type { DialogState } from "./form-dialog";
import RoleDialog from "./role-dialog";

export function UserRolesWorkspace({ canManage, saved, workspace }: { canManage: boolean; saved?: string; workspace: RoleWorkspaceData }) {
  const [dialog, setDialog] = useState<DialogState<ManagedRoleWithPermissions>>(null);
  const admins = workspace.roles.filter((role) => role.roleClass === "admin");
  const employees = workspace.roles.filter((role) => role.roleClass === "employee");
  const successMessage = saved === "created" ? "Role created and ready to assign." : saved === "updated" ? "Role permissions updated. Affected sessions were revoked." : saved === "archived" ? "Unused role archived." : "";
  return <section className="roles-workspace">
    <PageTitle actions={canManage && <button className="primary-button" onClick={() => setDialog("add")} type="button"><KeyRound aria-hidden="true" />Create role</button>} description="Control firm access with one sealed Super Admin class, delegated Admin roles, and reusable Employee categories." eyebrow="ACCESS GOVERNANCE" title="User Roles Management" />
    {successMessage && <p className="role-success-banner" role="status"><ShieldCheck aria-hidden="true" />{successMessage}</p>}
    <section className="kpi-grid roles-kpi-grid">
      <KpiCard icon="team" label="ACTIVE ADMINISTRATORS" note="Super Admin and delegated Admin users" tone="blue" value={String(workspace.metrics.activeAdmins).padStart(2, "0")} />
      <KpiCard icon="services" label="EMPLOYEE CATEGORIES" note="Reusable access definitions" tone="mint" value={String(workspace.metrics.employeeCategories).padStart(2, "0")} />
      <KpiCard icon="compliance" label="PROTECTED PERMISSIONS" note="Manage and approval controls" tone="amber" value={String(workspace.metrics.protectedPermissions).padStart(2, "0")} />
      <KpiCard icon="clients" label="ASSIGNED USERS" note="Active governed memberships" tone="blue" value={String(workspace.metrics.totalAssigned).padStart(2, "0")} />
    </section>

    <section className="surface-card super-admin-card">
      <span className="super-admin-icon"><Crown aria-hidden="true" /></span>
      <div className="super-admin-copy"><p className="eyebrow">SYSTEM-DEFINED · {accessClassLabel("super_admin").toUpperCase()}</p><h2>Full firm access, fixed by the system</h2><p>Super Admin controls every module, creates Admin roles, and manages Employee categories. This access cannot be edited through a permission matrix.</p><div className="super-admin-members">{workspace.superAdmins.map((admin) => <span key={admin.id}><b>{admin.fullName}</b><small>{admin.email}</small></span>)}</div></div>
      <div className="super-admin-lock"><LockKeyhole aria-hidden="true" /><strong>Protected</strong><span>Last Super Admin cannot be removed</span></div>
    </section>

    <div className="role-register-grid">
      <RoleRegister canManage={canManage} description="Permission sets for selected administration duties. Only Super Admin can create or assign these accounts." empty="No delegated Admin roles have been created." icon={<UserCog aria-hidden="true" />} onEdit={setDialog} roles={admins} title="Admin roles" />
      <RoleRegister canManage={canManage} description="Each employee receives exactly one category. Changes apply to every employee assigned to that category." empty="No Employee categories are available." icon={<UsersRound aria-hidden="true" />} onEdit={setDialog} roles={employees} title="Employee categories" />
      <RoleDialog dialog={dialog} onClose={() => setDialog(null)} />
    </div>
  </section>;
}

function RoleRegister({ canManage, description, empty, icon, onEdit, roles, title }: { canManage: boolean; description: string; empty: string; icon: ReactNode; onEdit: (role: ManagedRoleWithPermissions) => void; roles: RoleWorkspaceData["roles"]; title: string }) {
  return <section className="surface-card role-register-card"><header><span>{icon}</span><div><p className="eyebrow">ROLE REGISTER</p><h2>{title}</h2><p>{description}</p></div><strong>{roles.length}</strong></header><div className="role-register-list">{roles.map((role) => <article key={role.id}><div className="role-register-identity"><span className={role.roleClass === "admin" ? "is-admin" : "is-employee"}>{role.roleClass === "admin" ? <UserCog aria-hidden="true" /> : <UsersRound aria-hidden="true" />}</span><div><strong>{role.name}</strong><small>{role.description || "No description recorded."}</small></div></div><div className="role-register-stats"><span><b>{role.permissionCount}</b><small>permissions</small></span><span><b>{role.memberCount}</b><small>assigned users</small></span><StatusBadge tone={role.status === "active" ? "mint" : "red"}>{role.status}</StatusBadge></div>{canManage ? <button aria-label={`Edit ${role.name}`} onClick={() => onEdit(role)} type="button"><ArrowRight aria-hidden="true" /></button> : <ShieldCheck aria-label="View only" />}</article>)}{!roles.length && <div className="role-register-empty"><LockKeyhole aria-hidden="true" /><strong>{empty}</strong><span>{canManage ? "Create the first role to begin controlled assignment." : "Ask a Super Admin to configure this role class."}</span></div>}</div></section>;
}
