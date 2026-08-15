import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("dashboard typography uses one Geist stack and the approved scale", () => {
  assert.match(css, /body\{[^}]*font-family:var\(--font-geist-sans\)/);
  assert.doesNotMatch(css, /font-family:Arial,Helvetica,sans-serif/);

  for (const token of [
    "--type-page-title:32px",
    "--type-hero:28px",
    "--type-card-title:18px",
    "--type-kpi:26px",
    "--type-nav:13px",
    "--type-primary:12px",
    "--type-supporting:10px",
    "--type-label:9px",
    "--type-compact:9px",
  ]) {
    assert.ok(css.includes(token), `missing approved typography token ${token}`);
  }
});

test("Overview widgets use the readable typography tokens", () => {
  for (const [name, rule] of [
    ["queue labels", /\.table-labels\{[^}]*font-size:var\(--type-label\)/],
    ["client names", /\.client b\{[^}]*font-size:var\(--type-primary\)/],
    ["client metadata", /\.client small\{[^}]*font-size:var\(--type-compact\)/],
    ["owner names", /\.owner b\{[^}]*font-size:var\(--type-supporting\)/],
    ["deadline metadata", /\.deadline small\{[^}]*font-size:var\(--type-compact\)/],
    ["health legend", /\.health-copy span\{[^}]*font-size:var\(--type-supporting\)/],
    ["service rows", /\.service-list>div\{[^}]*font-size:var\(--type-compact\)/],
    ["radar metadata", /\.deadline-list article>div small\{[^}]*font-size:var\(--type-compact\)/],
  ] as const) {
    assert.match(css, rule, `${name} must use the approved readable scale`);
  }
});
