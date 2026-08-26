import type { ReactNode } from "react";

import WorkspaceRouteFrame from "../workspace-route-frame";

export default function EmployeesLayout({ children }: { children: ReactNode }) {
  return <WorkspaceRouteFrame active="Employees">{children}</WorkspaceRouteFrame>;
}
