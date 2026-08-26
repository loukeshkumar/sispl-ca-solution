import type { ReactNode } from "react";

import WorkspaceRouteFrame from "../workspace-route-frame";

export default function ClientPackagesLayout({ children }: { children: ReactNode }) {
  return <WorkspaceRouteFrame active="Client Packages">{children}</WorkspaceRouteFrame>;
}
