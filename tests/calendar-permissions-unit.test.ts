import assert from "node:assert/strict";
import test from "node:test";

import { LAYER_PERMISSION, permittedCalendarLayers } from "../lib/calendar/permissions";
import { CALENDAR_LAYERS } from "../lib/calendar/queue-params";

test("every layer names the permission it is drawn from", () => {
  // A layer added without a permission would default to visible, which is the
  // one way this page could leak a register it merely joins.
  for (const layer of CALENDAR_LAYERS) {
    assert.ok(LAYER_PERMISSION[layer.key], `${layer.key} has no permission`);
  }
});

test("an administrator sees every layer", () => {
  assert.deepEqual(
    permittedCalendarLayers({ roleKey: "firm_administrator" }),
    CALENDAR_LAYERS.map((layer) => layer.key),
  );
});

test("an associate is not shown the registers their role excludes", () => {
  // Associates have no billing, documents or team-attendance rights, so the
  // calendar must not become the place they read them.
  const layers = permittedCalendarLayers({ roleKey: "associate" });
  assert.equal(layers.includes("invoices"), false, "billing:read is not theirs");
  assert.equal(layers.includes("documents"), false, "documents:read is not theirs");
  assert.equal(layers.includes("leave"), false, "attendance:review is not theirs");
  assert.equal(layers.includes("work"), true, "the dashboard already shows them work");
  assert.equal(layers.includes("todos"), true, "their own to-dos are their own");
  assert.equal(layers.includes("dsc"), true, "associates do hold registers:read");
});

test("a manager sees the registers they run but not the firm's billing", () => {
  const layers = permittedCalendarLayers({ roleKey: "manager" });
  assert.equal(layers.includes("documents"), true);
  assert.equal(layers.includes("notices"), true);
  assert.equal(layers.includes("leave"), true, "managers review attendance");
  assert.equal(layers.includes("invoices"), false, "billing:read is a partner right");
});

test("an explicit permission list is honoured over the role default", () => {
  // Custom role definitions carry their own permission set; reading the role
  // key instead would grant a bespoke role whatever its name resembled.
  const layers = permittedCalendarLayers({ permissions: ["dashboard:read"], roleKey: "firm_administrator" });
  assert.deepEqual(layers.sort(), ["forecast", "holidays", "todos", "work"]);
});

test("a subject with no permissions is shown nothing", () => {
  assert.deepEqual(permittedCalendarLayers({ permissions: [], roleKey: "unknown_role" }), []);
});
