import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getDatabase } from "../dashboard/postgres/pool";
import { hashSessionToken, isSessionToken } from "../auth/tokens";
import { findPortalSessionByTokenHash, type PortalSession } from "./repository";

export const PORTAL_SESSION_COOKIE_NAME = "sispl_portal_session";
export const PORTAL_SESSION_DURATION_MS = 4 * 60 * 60_000;
const PORTAL_COOKIE_PATH = "/portal";

export async function setPortalSessionCookie(token: string, expiresAt: Date) {
  const cookieStore = await cookies();
  cookieStore.set(PORTAL_SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: PORTAL_COOKIE_PATH,
    expires: expiresAt,
  });
}

export async function clearPortalSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(PORTAL_SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: PORTAL_COOKIE_PATH,
    maxAge: 0,
  });
}

export async function getCurrentPortalSession(): Promise<PortalSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(PORTAL_SESSION_COOKIE_NAME)?.value ?? "";
  if (!isSessionToken(token)) return null;
  return findPortalSessionByTokenHash(getDatabase(), hashSessionToken(token));
}

/**
 * Gate for every authenticated portal surface. Portal sessions live in their own
 * table and cookie, so a staff session can never satisfy this check and a portal
 * session can never satisfy `requirePermission`.
 */
export async function requirePortalSession(options: { allowPasswordChange?: boolean } = {}) {
  const session = await getCurrentPortalSession();
  if (!session) redirect("/portal/login");
  if (session.mustChangePassword && !options.allowPasswordChange) redirect("/portal/password");
  return session;
}
