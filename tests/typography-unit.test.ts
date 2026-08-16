import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postcss from "postcss";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const root = postcss.parse(css);

const tokenSizes: Record<string, number> = {
  "var(--type-page-title)": 32,
  "var(--type-card-title)": 18,
  "var(--type-kpi)": 26,
  "var(--type-nav)": 14,
  "var(--type-primary)": 13,
  "var(--type-supporting)": 12,
  "var(--type-label)": 11,
  "var(--type-compact)": 11,
};

const propertyFor = (selector: string, property: string) => {
  let value: string | undefined;
  root.walkRules((rule) => {
    if (!rule.selectors.includes(selector)) return;
    rule.walkDecls(property, (declaration) => {
      value = declaration.value.trim();
    });
  });
  assert.ok(value, `missing ${property} declaration for ${selector}`);
  return value;
};

const tokenValue = (name: string) => {
  let value: string | undefined;
  root.walkDecls(name, (declaration) => {
    value = declaration.value.trim();
  });
  assert.ok(value, `missing ${name}`);
  return value;
};

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

test("dashboard uses Geist and the approved readable type scale", () => {
  assert.match(css, /font-family:\s*var\(--font-geist-sans\)/);
  assert.equal(propertyFor("body", "font-size"), "15px");

  for (const [token, value] of [
    ["--type-page-title", "32px"],
    ["--type-card-title", "18px"],
    ["--type-kpi", "26px"],
    ["--type-nav", "14px"],
    ["--type-primary", "13px"],
    ["--type-supporting", "12px"],
    ["--type-label", "11px"],
    ["--type-compact", "11px"],
  ] as const) assert.equal(tokenValue(token), value, `${token} must remain ${value}`);
});

test("semantic dashboard text uses the approved scale", () => {
  for (const [selector, token] of [
    [".sidebar-nav-button", "var(--type-nav)"],
    [".page-title", "var(--type-page-title)"],
    [".summary-ribbon-copy", "var(--type-primary)"],
    [".kpi-label", "var(--type-label)"],
    [".kpi-value", "var(--type-kpi)"],
    [".work-client-name", "var(--type-primary)"],
    [".work-meta", "var(--type-compact)"],
    [".insight-title", "var(--type-card-title)"],
    [".portfolio-client-name", "var(--type-primary)"],
    [".portfolio-meta", "var(--type-compact)"],
    [".client-detail-title", "var(--type-card-title)"],
  ] as const) assert.equal(propertyFor(selector, "font-size"), token, `${selector} must use ${token}`);
});

test("all CSS font sizes keep the 11px floor", () => {
  root.walkDecls("font-size", (declaration) => {
    const value = declaration.value.trim();
    const size = tokenSizes[value] ?? Number(value.replace("px", ""));
    assert.ok(Number.isFinite(size) && size >= 11, `sub-11px font-size declaration: ${value}`);
  });
});

test("normal text tokens maintain WCAG AA contrast", () => {
  const muted = tokenValue("--muted");
  const surface = tokenValue("--surface");
  const canvas = tokenValue("--canvas");
  const sidebarText = tokenValue("--sidebar-support");
  const navy = tokenValue("--navy");

  assert.ok(contrastRatio(muted, surface) >= 4.5, "muted text must pass on cards");
  assert.ok(contrastRatio(muted, canvas) >= 4.5, "muted text must pass on canvas");
  assert.ok(contrastRatio(sidebarText, navy) >= 4.5, "sidebar support text must pass on navigation surface");
});
