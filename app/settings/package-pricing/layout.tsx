import type { ReactNode } from "react";

import WorkspaceRouteFrame from "../../workspace-route-frame";

export default function PackagePricingLayout({ children }: { children: ReactNode }) {
  return <WorkspaceRouteFrame active="Package Setup">{children}</WorkspaceRouteFrame>;
}
