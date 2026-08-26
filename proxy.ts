import { NextResponse, type NextRequest } from "next/server";

import { classifyRoute, signInPathFor } from "./lib/auth/route-policy";

const SESSION_COOKIE = "sispl_session";
const PORTAL_SESSION_COOKIE = "sispl_portal_session";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Outer gate only (the `middleware` convention, renamed to `proxy` in Next.js 16).
 *
 * It checks that a plausible session cookie is present for the audience a path
 * belongs to; the session itself is still validated against the database by
 * `requirePermission` / `requirePortalSession` on every request. Next.js routes
 * Server Functions as POSTs to the page they live on, so proxy coverage can shift
 * when a route moves — per-action authorisation stays the authority, never this.
 *
 * Demo mode has no authentication at all, so the gate steps aside there.
 */
export function proxy(request: NextRequest) {
  if ((process.env.SISPL_DATA_SOURCE?.trim().toLowerCase() ?? "demo") !== "postgres") return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  const audience = classifyRoute(pathname);
  if (audience === "public") return NextResponse.next();

  const cookieName = audience === "portal" ? PORTAL_SESSION_COOKIE : SESSION_COOKIE;
  const token = request.cookies.get(cookieName)?.value ?? "";
  if (TOKEN_PATTERN.test(token)) return NextResponse.next();

  const destination = request.nextUrl.clone();
  const target = signInPathFor(audience, pathname, search);
  destination.pathname = target.split("?")[0];
  destination.search = target.includes("?") ? `?${target.split("?").slice(1).join("?")}` : "";
  return NextResponse.redirect(destination);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
