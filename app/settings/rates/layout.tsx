import type { ReactNode } from "react";

import WorkspaceRouteFrame from "../../workspace-route-frame";

export default function RateCardLayout({ children }: { children: ReactNode }) {
  return <WorkspaceRouteFrame active="Rate Card">{children}</WorkspaceRouteFrame>;
}
