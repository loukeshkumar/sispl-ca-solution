import type { ReactNode } from "react";

import WorkspaceRouteFrame from "../../workspace-route-frame";

export default function AttendanceMastersLayout({ children }: { children: ReactNode }) {
  return <WorkspaceRouteFrame active="Attendance Masters">{children}</WorkspaceRouteFrame>;
}
