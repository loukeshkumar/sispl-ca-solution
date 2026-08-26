import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getDatabase } from "../dashboard/postgres/pool";
import { hasPermission, type Permission } from "./authorization";
import { findSessionByTokenHash, type AuthSession } from "./repository";
import { hashSessionToken, isSessionToken } from "./tokens";

export const SESSION_COOKIE_NAME = "sispl_session";
export const SESSION_DURATION_MS = 8 * 60 * 60_000;

export async function setSessionCookie(token: string, expiresAt: Date) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function getCurrentAuthSession(): Promise<AuthSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? "";
  if (!isSessionToken(token)) return null;
  return findSessionByTokenHash(getDatabase(), hashSessionToken(token));
}

export type RouteAuthorization =
  | { ok: true; session: AuthSession }
  | { ok: false; reason: "authentication_required" | "password_change_required" | "permission_denied" };

export async function authorizeRoutePermission(permission: Permission): Promise<RouteAuthorization> {
  const session = await getCurrentAuthSession();
  if (!session) return { ok: false, reason: "authentication_required" };
  if (session.mustChangePassword) return { ok: false, reason: "password_change_required" };
  if (!hasPermission(session, permission)) return { ok: false, reason: "permission_denied" };
  return { ok: true, session };
}

export async function requirePermission(permission: Permission, returnTo = "/") {
  const session = await getCurrentAuthSession();
  if (!session) redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  if (session.mustChangePassword) redirect("/account/change-password");
  if (!hasPermission(session, permission)) redirect("/forbidden");
  return session;
}

export async function requireSuperAdmin(returnTo = "/") {
  const session = await requirePermission("roles:manage", returnTo);
  if (session.accessClass !== "super_admin") redirect("/forbidden");
  return session;
}
