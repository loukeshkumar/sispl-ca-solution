import type { ReactNode } from "react";

import WorkspaceRouteFrame from "../../workspace-route-frame";

export default function UtilisationTargetsLayout({ children }: { children: ReactNode }) {
  return <WorkspaceRouteFrame active="Utilisation Targets">{children}</WorkspaceRouteFrame>;
}
