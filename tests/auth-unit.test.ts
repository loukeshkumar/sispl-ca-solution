import assert from "node:assert/strict";
import test from "node:test";

import { hasPermission, roleLabel } from "../lib/auth/authorization";
import { hashPassword, validateNewPassword, verifyPassword } from "../lib/auth/password";
import { safeReturnPath } from "../lib/auth/redirects";
import { getLoginRateLimits } from "../lib/auth/rate-limit";
import { createSessionToken, hashSessionToken, isSessionToken } from "../lib/auth/tokens";
import { createTemporaryPassword } from "../lib/auth/temporary-password";

test("passwords use a salted scrypt hash and constant-time verification", async () => {
  const password = "Correct horse 2026!";
  const first = await hashPassword(password);
  const second = await hashPassword(password);

  assert.match(first, /^scrypt\$16384\$8\$1\$/);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword("Incorrect password", first), false);
  assert.equal(await verifyPassword(password, "malformed"), false);
});

test("new passwords have explicit safe length boundaries", () => {
  assert.match(validateNewPassword("too-short") ?? "", /at least 12/);
  assert.match(validateNewPassword("x".repeat(129)) ?? "", /no more than 128/);
  assert.equal(validateNewPassword("Strong local password!"), null);
});

test("session tokens are random, validated, and stored by hash", () => {
  const first = createSessionToken();
  const second = createSessionToken();

  assert.equal(isSessionToken(first), true);
  assert.notEqual(first, second);
  assert.notEqual(hashSessionToken(first), first);
  assert.equal(hashSessionToken(first), hashSessionToken(first));
  assert.equal(isSessionToken("not-a-session-token"), false);
});

test("temporary employee passwords are high-entropy and human transferable", () => {
  const first = createTemporaryPassword();
  const second = createTemporaryPassword();
  assert.equal(first.length, 20);
  assert.match(first, /[A-Z]/);
  assert.match(first, /[a-z]/);
  assert.match(first, /[0-9]/);
  assert.match(first, /[^A-Za-z0-9]/);
  assert.notEqual(first, second);
});

test("return paths cannot escape the local application or loop into auth pages", () => {
  assert.equal(safeReturnPath("/clients?risk=watch"), "/clients?risk=watch");
  assert.equal(safeReturnPath("https://example.com"), "/");
  assert.equal(safeReturnPath("//example.com"), "/");
  assert.equal(safeReturnPath("/login"), "/");
});

test("role permissions follow least privilege and reject unknown roles", () => {
  assert.equal(hasPermission("associate", "dashboard:read"), true);
  assert.equal(hasPermission("associate", "clients:write"), false);
  assert.equal(hasPermission("associate", "documents:read"), false);
  assert.equal(hasPermission("manager", "documents:read"), true);
  assert.equal(hasPermission("manager", "work:write"), true);
  assert.equal(hasPermission("partner", "billing:read"), true);
  assert.equal(hasPermission("unknown", "dashboard:read"), false);
  assert.equal(roleLabel("firm_administrator"), "Firm administrator");
  assert.equal(hasPermission("partner", "team:manage"), true);
  assert.equal(hasPermission("manager", "team:read"), true);
  assert.equal(hasPermission("manager", "tasks:assign"), true);
  assert.equal(hasPermission("associate", "tasks:read"), true);
  assert.equal(hasPermission("associate", "tasks:update:own"), true);
  assert.equal(hasPermission("associate", "team:read"), false);
  assert.equal(hasPermission("associate", "tasks:assign"), false);
  assert.equal(hasPermission("associate", "attendance:use"), true);
  assert.equal(hasPermission("associate", "attendance:review"), false);
  assert.equal(hasPermission("manager", "attendance:review"), true);
  assert.equal(hasPermission("manager", "attendance:manage"), false);
  assert.equal(hasPermission("partner", "attendance:manage"), true);
  assert.equal(hasPermission("associate", "salary:read:own"), true);
  assert.equal(hasPermission("manager", "salary:manage"), false);
  assert.equal(hasPermission("firm_administrator", "salary:manage"), true);
  assert.equal(hasPermission("partner", "salary:approve"), true);
  assert.equal(hasPermission("firm_administrator", "packages:manage"), true);
  assert.equal(hasPermission("partner", "packages:manage"), true);
  assert.equal(hasPermission("manager", "packages:read"), true);
  assert.equal(hasPermission("manager", "client_packages:manage"), true);
  assert.equal(hasPermission("manager", "packages:manage"), false);
  assert.equal(hasPermission("associate", "packages:read"), false);
  assert.equal(hasPermission("associate", "client_packages:manage"), false);
  assert.equal(hasPermission("firm_administrator", "services:manage"), true);
  assert.equal(hasPermission("firm_administrator", "roles:manage"), true);
  assert.equal(hasPermission({ roleKey: "partner", permissions: ["dashboard:read"] }, "team:manage"), false);
  assert.equal(hasPermission({ roleKey: "associate", permissions: ["roles:read"] }, "roles:read"), true);
  assert.equal(hasPermission("partner", "services:manage"), true);
  assert.equal(hasPermission("manager", "services:read"), true);
  assert.equal(hasPermission("manager", "services:manage"), false);
  assert.equal(hasPermission("associate", "services:read"), false);
});

test("login rate-limit keys never retain raw client addresses", () => {
  const requestHeaders = new Headers({ "x-forwarded-for": "203.0.113.42, 10.0.0.1" });
  const trusted = getLoginRateLimits(requestHeaders, { AUTH_TRUST_PROXY_HEADERS: "true" });
  const direct = getLoginRateLimits(requestHeaders, { AUTH_TRUST_PROXY_HEADERS: "false" });
  assert.equal(trusted.length, 2);
  assert.ok(trusted.every((limit) => /^[0-9a-f]{64}$/.test(limit.keyHash)));
  assert.ok(trusted.every((limit) => !limit.keyHash.includes("203.0.113.42")));
  assert.notEqual(trusted[1].keyHash, direct[1].keyHash);
});
