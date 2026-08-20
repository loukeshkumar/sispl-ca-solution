import type { ReactNode } from "react";

import WorkspaceRouteFrame from "../workspace-route-frame";

export default function TasksLayout({ children }: { children: ReactNode }) {
  return <WorkspaceRouteFrame active="Tasks">{children}</WorkspaceRouteFrame>;
}
