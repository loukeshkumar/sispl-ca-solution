import type { ReactNode } from "react";

/**
 * Pass-through. Each route under /team mounts its own frame so it can name
 * itself in the sidebar; a frame here would wrap them all as "Employees" and
 * highlight the wrong item, and nesting a second frame inside it would render
 * the shell twice.
 */
export default function TeamLayout({ children }: { children: ReactNode }) {
  return children;
}
