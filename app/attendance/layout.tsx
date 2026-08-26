import type { ReactNode } from "react";
import WorkspaceRouteFrame from "../workspace-route-frame";
export default function AttendanceLayout({ children }: { children: ReactNode }) { return <WorkspaceRouteFrame active="Attendance">{children}</WorkspaceRouteFrame>; }
