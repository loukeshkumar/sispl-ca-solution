import type { ReactNode } from "react";

import WorkspaceRouteFrame from "../workspace-route-frame";

export default function PackagesLayout({ children }: { children: ReactNode }) {
  return <WorkspaceRouteFrame active="Package Setup">{children}</WorkspaceRouteFrame>;
}
