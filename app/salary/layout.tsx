import type { ReactNode } from "react";

import WorkspaceRouteFrame from "../workspace-route-frame";

export default function SalaryLayout({ children }: { children: ReactNode }) {
  return <WorkspaceRouteFrame active="Salary">{children}</WorkspaceRouteFrame>;
}
