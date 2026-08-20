import type { ReactNode } from "react";

import WorkspaceRouteFrame from "../workspace-route-frame";

export default function TodosLayout({ children }: { children: ReactNode }) {
  return <WorkspaceRouteFrame active="To-do">{children}</WorkspaceRouteFrame>;
}
