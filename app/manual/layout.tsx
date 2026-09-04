import type { ReactNode } from "react";

import WorkspaceRouteFrame from "../workspace-route-frame";

export default function ManualLayout({ children }: { children: ReactNode }) {
  return <WorkspaceRouteFrame active="Manual">{children}</WorkspaceRouteFrame>;
}
