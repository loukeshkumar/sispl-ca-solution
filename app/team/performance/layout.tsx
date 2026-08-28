import type { ReactNode } from "react";

import WorkspaceRouteFrame from "../../workspace-route-frame";

export default function PerformanceLayout({ children }: { children: ReactNode }) {
  return <WorkspaceRouteFrame active="Performance">{children}</WorkspaceRouteFrame>;
}
