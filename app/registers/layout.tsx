import type { ReactNode } from "react";

import WorkspaceRouteFrame from "../workspace-route-frame";

export default function RegistersLayout({ children }: { children: ReactNode }) {
  return <WorkspaceRouteFrame active="Registers">{children}</WorkspaceRouteFrame>;
}
