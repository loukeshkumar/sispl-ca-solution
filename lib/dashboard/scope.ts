/**
 * How much of the firm a viewer's dashboard shows.
 *
 * Every role already declares this as its resource scope, and the membership
 * carries it as `roleKey`, so nothing new has to be stored to honour it.
 */
export type DashboardScope =
  | { kind: "firm" }
  | { kind: "team"; userIds: string[] }
  | { kind: "own"; userId: string };

export type ScopeViewer = { accessClass?: string; roleKey: string; userId: string };

export const FIRM_SCOPE: DashboardScope = { kind: "firm" };

/**
 * An unrecognised role resolves to the narrowest scope rather than the widest:
 * a visibility rule that fails open is not a visibility rule.
 */
export function dashboardScopeFor(viewer: ScopeViewer, directReports: string[]): DashboardScope {
  if (viewer.accessClass === "super_admin") return FIRM_SCOPE;
  if (viewer.roleKey === "firm_administrator" || viewer.roleKey === "partner") return FIRM_SCOPE;
  if (viewer.roleKey === "manager") return { kind: "team", userIds: [viewer.userId, ...directReports] };
  return { kind: "own", userId: viewer.userId };
}

/** The users a scoped query filters on, or `null` when it should not filter. */
export function scopedUserIds(scope: DashboardScope): string[] | null {
  if (scope.kind === "firm") return null;
  return scope.kind === "own" ? [scope.userId] : scope.userIds;
}
