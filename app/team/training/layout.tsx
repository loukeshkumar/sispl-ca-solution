import type { ReactNode } from "react";

import WorkspaceRouteFrame from "../../workspace-route-frame";

export default function TrainingLayout({ children }: { children: ReactNode }) {
  return <WorkspaceRouteFrame active="Training & CPE">{children}</WorkspaceRouteFrame>;
}
