import type { ReactNode } from "react";

import WorkspaceRouteFrame from "../workspace-route-frame";

export default function ClientsLayout({ children }: { children: ReactNode }) {
  return <WorkspaceRouteFrame active="Clients">{children}</WorkspaceRouteFrame>;
}
