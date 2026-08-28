import type { ReactNode } from "react";

import WorkspaceRouteFrame from "../../workspace-route-frame";

export default function ArticleshipLayout({ children }: { children: ReactNode }) {
  return <WorkspaceRouteFrame active="Articleship">{children}</WorkspaceRouteFrame>;
}
