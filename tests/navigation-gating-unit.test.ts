import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { Permission } from "../lib/auth/authorization";
import { canOpenWorkspace, openWorkspaces, workspacePermissions } from "../lib/dashboard/navigation";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

/** A leaf is a destination; a section or group label sits on its own line. */
const leafLabels = (shell: string) =>
  [...shell.matchAll(/\{ (?:href: "[^"]+", )?icon: "[^"]+", label: "([^"]+)" \}/g)].map((match) => match[1]);

const viewerWith = (...permissions: Permission[]) => ({ permissions, roleKey: "associate" });

/**
 * Every destination is a decision. Leaving one out of both lists is how a
 * menu item ends up visible to everybody by accident, which is what happened
 * to Rate Card, Utilisation Targets and eleven others.
 */
test("every sidebar destination is either gated or deliberately open", async () => {
  const labels = leafLabels(await read("../app/dashboard/dashboard-shell.tsx"));
  assert.ok(labels.length >= 28, `expected the sidebar destinations to be found, got ${labels.length}`);

  for (const label of labels) {
    assert.ok(
      label in workspacePermissions || openWorkspaces.has(label),
      `"${label}" is neither gated nor listed as open, so every role sees it`,
    );
  }
});

test("a destination listed as open is not also gated", () => {
  for (const label of openWorkspaces) {
    assert.ok(!(label in workspacePermissions), `"${label}" is listed as both open and gated`);
  }
});

test("the gate hides what the viewer's role cannot open", () => {
  const associate = viewerWith("dashboard:read", "tasks:read", "salary:read:own", "attendance:use");

  assert.equal(canOpenWorkspace(associate, "Rate Card"), false);
  assert.equal(canOpenWorkspace(associate, "Utilisation Targets"), false);
  assert.equal(canOpenWorkspace(associate, "Clients"), false);
  assert.equal(canOpenWorkspace(associate, "Articleship"), false);
  assert.equal(canOpenWorkspace(associate, "Work Procedures"), false);
  assert.equal(canOpenWorkspace(associate, "Insights"), false);

  // Its own work, its own pay, its own attendance: held by every role.
  assert.equal(canOpenWorkspace(associate, "My work"), true);
  assert.equal(canOpenWorkspace(associate, "Salary"), true);
  assert.equal(canOpenWorkspace(associate, "Attendance"), true);
  assert.equal(canOpenWorkspace(associate, "Overview"), true);

  // Performance stays open: an employee without the permission still reads the
  // reviews written about them, which the page itself filters down to.
  assert.equal(canOpenWorkspace(associate, "Performance"), true);
});

test("a partner keeps the destinations its permissions cover", () => {
  const partner = viewerWith("dashboard:read", "billing:read", "timesheets:manage", "clients:write", "services:read", "team:read");

  assert.equal(canOpenWorkspace(partner, "Rate Card"), true);
  assert.equal(canOpenWorkspace(partner, "Utilisation Targets"), true);
  assert.equal(canOpenWorkspace(partner, "Clients"), true);
  assert.equal(canOpenWorkspace(partner, "Articleship"), true);
});

/**
 * Hiding the door is not locking it. The dashboard reads a workspace from the
 * URL, so the same rule has to refuse it there or `?workspace=salary` still
 * opens for somebody the sidebar hid it from.
 */
test("the dashboard refuses a workspace it hides from the sidebar", async () => {
  const page = await read("../app/page.tsx");

  assert.match(page, /canOpenWorkspace\(session, initialWorkspace\)/);
  assert.match(page, /redirect\("\/forbidden"\)/);
  assert.doesNotMatch(
    page,
    /initialWorkspace === "Billing" && !canReadBilling/,
    "the hand-written redirect chain covered only some workspaces; the shared rule replaces it",
  );
});
