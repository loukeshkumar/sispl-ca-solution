import type { ReactNode } from "react";

import WorkspaceRouteFrame from "../workspace-route-frame";

export default function WorkLayout({ children }: { children: ReactNode }) {
  return <WorkspaceRouteFrame active="My work">{children}</WorkspaceRouteFrame>;
}
