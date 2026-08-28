import assert from "node:assert/strict";
import test from "node:test";

import { dashboardScopeFor, scopedUserIds, FIRM_SCOPE } from "../lib/dashboard/scope";

const viewer = (roleKey: string, accessClass?: string) => ({ accessClass, roleKey, userId: "me" });

test("firm-wide roles see the whole firm", () => {
  assert.deepEqual(dashboardScopeFor(viewer("partner"), []), { kind: "firm" });
  assert.deepEqual(dashboardScopeFor(viewer("firm_administrator"), []), { kind: "firm" });
  // A Super Admin's legacy role key is irrelevant: the access class decides.
  assert.deepEqual(dashboardScopeFor(viewer("associate", "super_admin"), []), { kind: "firm" });
});

test("a manager sees themselves and their direct reports", () => {
  assert.deepEqual(dashboardScopeFor(viewer("manager"), ["a", "b"]), { kind: "team", userIds: ["me", "a", "b"] });
});

test("a manager with no configured reports sees only their own work", () => {
  assert.deepEqual(dashboardScopeFor(viewer("manager"), []), { kind: "team", userIds: ["me"] });
});

test("an associate, and anything unrecognised, sees only their own work", () => {
  assert.deepEqual(dashboardScopeFor(viewer("associate"), ["a"]), { kind: "own", userId: "me" });
  assert.deepEqual(dashboardScopeFor(viewer(""), ["a"]), { kind: "own", userId: "me" });
  assert.deepEqual(dashboardScopeFor(viewer("something-new"), []), { kind: "own", userId: "me" });
});

test("scopedUserIds reports the users a query should filter on", () => {
  assert.equal(scopedUserIds(FIRM_SCOPE), null);
  assert.deepEqual(scopedUserIds({ kind: "own", userId: "me" }), ["me"]);
  assert.deepEqual(scopedUserIds({ kind: "team", userIds: ["me", "a"] }), ["me", "a"]);
});
