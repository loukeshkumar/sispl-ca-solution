import type { ReactNode } from "react";

import WorkspaceRouteFrame from "../workspace-route-frame";

export default function NotificationsLayout({ children }: { children: ReactNode }) {
  return <WorkspaceRouteFrame active="Notifications">{children}</WorkspaceRouteFrame>;
}
