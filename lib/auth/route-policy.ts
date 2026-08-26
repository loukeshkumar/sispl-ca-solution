export type RouteAudience = "public" | "staff" | "portal";

/**
 * Deny-by-default routing policy.
 *
 * Authorisation still happens per page and per action against the database —
 * this is the outer layer that decides which *kind* of session may even reach a
 * path. It exists so a route added without `requirePermission` fails closed
 * instead of being silently public.
 */
const PUBLIC_PATHS = new Set([
  "/login",
  "/forbidden",
  "/portal/login",
]);

const PUBLIC_PREFIXES = [
  "/_next/",
  "/favicon",
  "/og.png",
  "/robots.txt",
  "/sitemap.xml",
];

export function classifyRoute(pathname: string): RouteAudience {
  if (PUBLIC_PATHS.has(pathname)) return "public";
  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return "public";
  if (pathname === "/portal" || pathname.startsWith("/portal/")) return "portal";
  return "staff";
}

export function signInPathFor(audience: RouteAudience, pathname: string, search: string) {
  if (audience === "portal") return "/portal/login";
  const returnTo = `${pathname}${search}`;
  return `/login?returnTo=${encodeURIComponent(returnTo)}`;
}
