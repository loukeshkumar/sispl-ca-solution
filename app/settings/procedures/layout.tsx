import type { ReactNode } from "react";

import WorkspaceRouteFrame from "../../workspace-route-frame";

export default function WorkProceduresLayout({ children }: { children: ReactNode }) {
  return <WorkspaceRouteFrame active="Work Procedures">{children}</WorkspaceRouteFrame>;
}
