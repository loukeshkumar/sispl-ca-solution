import type { ReactNode } from "react";

import WorkspaceRouteFrame from "../../workspace-route-frame";

export default function ComplianceSchedulesLayout({ children }: { children: ReactNode }) {
  return <WorkspaceRouteFrame active="Service Management">{children}</WorkspaceRouteFrame>;
}
