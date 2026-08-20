import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { classifyRoute, signInPathFor } from "../lib/auth/route-policy";
import { allPermissions, hasPermission, legacyPermissionsForRole } from "../lib/auth/authorization";

test("only the sign-in and error surfaces are public", () => {
  for (const pathname of ["/login", "/forbidden", "/portal/login", "/_next/static/chunk.js", "/favicon.svg"]) {
    assert.equal(classifyRoute(pathname), "public", `${pathname} should be public`);
  }
});

test("portal paths require a portal session and everything else requires a staff session", () => {
  assert.equal(classifyRoute("/portal"), "portal");
  assert.equal(classifyRoute("/portal/password"), "portal");
  for (const pathname of ["/", "/clients/new", "/billing", "/registers/udin/new", "/timesheets"]) {
    assert.equal(classifyRoute(pathname), "staff", `${pathname} should require a staff session`);
  }
});

test("an unknown route added tomorrow is gated, not silently public", () => {
  assert.equal(classifyRoute("/some-feature-nobody-gated-yet"), "staff");
  assert.equal(classifyRoute("/portal/some-new-client-page"), "portal");
});

test("sign-in redirects preserve the staff destination and never leak it to the portal", () => {
  assert.equal(signInPathFor("staff", "/clients/new", "?x=1"), `/login?returnTo=${encodeURIComponent("/clients/new?x=1")}`);
  assert.equal(signInPathFor("portal", "/portal/password", "?x=1"), "/portal/login");
});

test("the proxy guards every path except Next.js build assets", async () => {
  const source = await readFile(new URL("../proxy.ts", import.meta.url), "utf8");
  assert.match(source, /export function proxy\(/, "Next.js 16 requires the export to be named `proxy`");
  assert.match(source, /matcher/);
  assert.match(source, /_next\/static/);
  assert.match(source, /sispl_portal_session/);
  assert.ok(!/getDatabase|drizzle/.test(source), "the proxy must not query the database on every request");
});

test("the deprecated middleware convention is not left behind alongside the proxy", async () => {
  // Next.js 16 renamed `middleware.ts` to `proxy.ts`; keeping both would be ambiguous.
  await assert.rejects(readFile(new URL("../middleware.ts", import.meta.url), "utf8"));
});

test("legacy role permissions resolve from one source that agrees with hasPermission", () => {
  for (const roleKey of ["partner", "manager", "associate"]) {
    const legacy = legacyPermissionsForRole(roleKey);
    assert.ok(legacy.length > 0, `${roleKey} should resolve permissions`);
    for (const permission of allPermissions) {
      assert.equal(
        legacy.includes(permission),
        hasPermission(roleKey, permission),
        `${roleKey} must resolve ${permission} identically through both paths`,
      );
    }
  }
  assert.deepEqual(legacyPermissionsForRole("not-a-role"), []);
});

test("legacy partner permissions include the modules added since the map was written", () => {
  const partner = legacyPermissionsForRole("partner");
  for (const permission of ["team:manage", "attendance:manage", "salary:manage", "packages:manage", "services:manage", "billing:read", "registers:manage", "timesheets:manage"] as const) {
    assert.ok(partner.includes(permission), `partner should hold ${permission}`);
  }
  assert.ok(!legacyPermissionsForRole("associate").includes("billing:manage"));
});
