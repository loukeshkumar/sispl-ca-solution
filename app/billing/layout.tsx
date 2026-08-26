import type { ReactNode } from "react";

import WorkspaceRouteFrame from "../workspace-route-frame";

export default function BillingLayout({ children }: { children: ReactNode }) {
  return <WorkspaceRouteFrame active="Billing">{children}</WorkspaceRouteFrame>;
}
