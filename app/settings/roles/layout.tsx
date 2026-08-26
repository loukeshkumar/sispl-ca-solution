import type { ReactNode } from "react";

import WorkspaceRouteFrame from "../../workspace-route-frame";

export default function UserRolesLayout({ children }: { children: ReactNode }) {
  return <WorkspaceRouteFrame active="User Roles Management">{children}</WorkspaceRouteFrame>;
}
