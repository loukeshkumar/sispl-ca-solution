import type { ReactNode } from "react";

import WorkspaceRouteFrame from "../workspace-route-frame";

export default function DocumentsLayout({ children }: { children: ReactNode }) {
  return <WorkspaceRouteFrame active="Documents">{children}</WorkspaceRouteFrame>;
}
