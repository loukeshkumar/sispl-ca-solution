import type { ReactNode } from "react";

import WorkspaceRouteFrame from "../../workspace-route-frame";

export default function MasterDataLayout({ children }: { children: ReactNode }) {
  return <WorkspaceRouteFrame active="Master Data">{children}</WorkspaceRouteFrame>;
}
