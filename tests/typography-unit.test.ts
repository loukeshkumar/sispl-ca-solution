import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

const finalProperty = (selector: string, property: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...css.matchAll(new RegExp(`${escaped}\\{[^}]*${property}:([^;}]+)`, "g"))];
  assert.ok(matches.length > 0, `missing ${property} declaration for ${selector}`);
  return matches.at(-1)![1];
};

const finalFontSize = (selector: string) => finalProperty(selector, "font-size");

const contrastRatio = (foreground: string, background: string) => {
  const channel = (hex: string, offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = (hex: string) => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
};

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
    ["pulse score label", /\.pulse-score>span\{[^}]*font-size:var\(--type-compact\)/],
    ["pulse score status", /\.pulse-score>em\{[^}]*font-size:var\(--type-compact\)/],
    ["pulse action avatars", /\.pulse-actions>span i\{[^}]*font-size:var\(--type-compact\)/],
    ["client avatar initials", /\.client>span\{[^}]*font-size:var\(--type-compact\)/],
    ["portfolio owner initials", /\.portfolio-owner span\{[^}]*font-size:var\(--type-compact\)/],
    ["active service status", /\.active-services b\{[^}]*font-size:var\(--type-compact\)/],
  ] as const) {
    assert.match(css, rule, `${name} must use the approved readable scale`);
  }

  assert.equal(finalFontSize(".portfolio-owner span"), "var(--type-compact)");
  assert.equal(finalFontSize(".active-services b"), "var(--type-compact)");
  for (const selector of [".upgrade>div b", ".account>span", ".account>button", ".float-card>span"] as const) {
    assert.equal(finalFontSize(selector), "var(--type-compact)");
  }
  assert.equal(finalFontSize(".title-row h1"), "var(--type-page-title)");
  assert.equal(finalFontSize(".clients-title h1"), "var(--type-page-title)");
  assert.equal(finalFontSize(".side nav button"), "var(--type-nav)");

  for (const selector of [".client small", ".client-metrics small", ".entity-cell small", ".database-error-card small"] as const) {
    const color = finalProperty(selector, "color");
    assert.match(color, /^#[0-9a-f]{6}$/i, `${selector} must use a hex color`);
    assert.ok(contrastRatio(color, "#ffffff") >= 4.5, `${selector} color ${color} must meet WCAG AA contrast`);
  }
});
