import type { ReactNode } from "react";

import { requirePermission } from "../lib/auth/server";
import { getDatabase } from "../lib/dashboard/postgres/pool";
import { getPostgresDashboardDataForTenant } from "../lib/dashboard/postgres/provider";
import { countUnreadNotifications } from "../lib/notifications/repository";
import AuthenticatedWorkspaceShell from "./authenticated-workspace-shell";

export default async function WorkspaceRouteFrame({ active, children }: { active: string; children: ReactNode }) {
  const session = await requirePermission("dashboard:read");
  const [data, unreadNotifications] = await Promise.all([
    getPostgresDashboardDataForTenant(session.tenantId),
    countUnreadNotifications(getDatabase(), session.tenantId, session.userId),
  ]);
  return (
    <AuthenticatedWorkspaceShell
      active={active}
      data={data}
      unreadNotifications={unreadNotifications}
      viewer={{ accessClass: session.accessClass, email: session.email, fullName: session.fullName, permissions: session.permissions, roleKey: session.roleKey, roleName: session.roleName, userId: session.userId }}
    >
      {children}
    </AuthenticatedWorkspaceShell>
  );
}
