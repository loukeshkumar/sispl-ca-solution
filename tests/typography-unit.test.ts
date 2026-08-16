import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postcss from "postcss";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

const specificity = (selector: string) => {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes = (selector.match(/\.[\w-]+|\[[^]]+\]|:[\w-]+/g) ?? []).length;
  const elements = (selector.replace(/[#.][\w-]+|\[[^]]+\]|:[\w-]+/g, "").match(/[a-zA-Z]+/g) ?? []).length;
  return ids * 100 + classes * 10 + elements;
};

const mediaApplies = (params: string, viewport: number) => {
  const max = params.match(/max-width\s*:\s*(\d+)px/);
  const min = params.match(/min-width\s*:\s*(\d+)px/);
  return (!max || viewport <= Number(max[1])) && (!min || viewport >= Number(min[1]));
};

const resolveCssProperty = (source: string, selector: string, property: string, viewport = 1440) => {
  const root = postcss.parse(source);
  let order = 0;
  let winner: { value: string; important: boolean; specificity: number; order: number } | undefined;
  const visit = (container: postcss.Container, active: boolean) => {
    container.each((node) => {
      if (node.type === "atrule" && node.name === "media") {
        visit(node as postcss.Container, active && mediaApplies(node.params, viewport));
      } else if (node.type === "rule" && active && node.selectors.some((item) => item.trim() === selector)) {
        node.walkDecls(property, (decl) => {
          const candidate = { value: decl.value.trim(), important: decl.important, specificity: specificity(selector), order: order++ };
          if (!winner || (candidate.important !== winner.important ? candidate.important : candidate.specificity >= winner.specificity)) winner = candidate;
        });
      }
      order++;
    });
  };
  visit(root, true);
  assert.ok(winner, `missing ${property} declaration for ${selector}`);
  return winner!.value;
};

const finalProperty = (selector: string, property: string) => resolveCssProperty(css, selector, property);

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
  assert.equal(finalFontSize("body"), "15px");
  assert.match(css, /@media\(max-width:780px\)\{body\{font-size:15px\}/);

  for (const token of [
    "--type-page-title:32px",
    "--type-hero:30px",
    "--type-card-title:18px",
    "--type-kpi:26px",
    "--type-nav:14px",
    "--type-primary:13px",
    "--type-supporting:12px",
    "--type-label:11px",
    "--type-compact:11px",
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
  const finalCascadeTable = [
    [".firm-card small", "var(--type-label)"], [".firm-card b", "var(--type-primary)"], [".firm-card em", "var(--type-supporting)"],
    [".section-label", "var(--type-label)"], [".side nav button", "var(--type-nav)"], [".upgrade p", "var(--type-supporting)"],
    [".account small", "var(--type-compact)"], [".global-search input", "var(--type-primary)"], [".pulse-copy>p", "var(--type-supporting)"],
    [".metrics>button>div:nth-child(2)>span", "var(--type-label)"], [".metrics>button>div:nth-child(2)>small", "var(--type-compact)"],
    [".table-labels", "var(--type-label)"], [".client b", "var(--type-primary)"], [".client p", "var(--type-supporting)"],
    [".client small", "var(--type-compact)"], [".owner b", "var(--type-supporting)"], [".deadline small", "var(--type-compact)"],
    [".health-copy span", "var(--type-supporting)"], [".service-list>div", "var(--type-compact)"], [".deadline-list article>div small", "var(--type-compact)"],
    [".client-metrics small", "var(--type-label)"], [".entity-cell b", "var(--type-primary)"], [".entity-cell small", "var(--type-compact)"],
    [".service-chips span", "var(--type-compact)"], [".client-health>b", "var(--type-compact)"], [".next-item b", "var(--type-compact)"],
    [".portfolio-owner b", "var(--type-compact)"], [".c360-cover p", "var(--type-compact)"], [".c360-tabs button", "var(--type-compact)"],
    [".c360-cover small", "var(--type-compact)"], [".c360-cover h2", "var(--type-card-title)"], [".c360-cover p", "var(--type-compact)"],
    [".c360-tabs button", "var(--type-compact)"], [".profile-health span", "var(--type-compact)"], [".profile-health em", "var(--type-compact)"],
    [".detail-label", "var(--type-compact)"], [".detail-grid small", "var(--type-compact)"], [".detail-grid b", "var(--type-compact)"],
    [".active-services>span", "var(--type-compact)"], [".active-services b", "var(--type-compact)"], [".next-action b", "var(--type-compact)"],
    [".next-action small", "var(--type-compact)"], [".next-action button", "var(--type-compact)"], [".c360-actions button", "var(--type-compact)"],
    [".database-error-card small", "var(--type-compact)"],
  ] as const;
  for (const [selector, token] of finalCascadeTable) {
    assert.equal(finalFontSize(selector), token, `${selector} final cascade must resolve to ${token}`);
  }
  for (const [selector, token] of [
    [".logo small", "var(--type-compact)"],
    [".firm-card>span", "var(--type-compact)"],
    [".side nav em", "var(--type-compact)"],
    [".title-row>div:first-child>p", "var(--type-label)"],
    [".clients-title p", "var(--type-label)"],
    [".portfolio-tools>div button", "var(--type-compact)"],
    [".filter-btn", "var(--type-compact)"],
    [".profile-health em", "var(--type-compact)"],
    [".database-error-card>span", "var(--type-compact)"],
    [".next-action button", "var(--type-compact)"],
  ] as const) {
    assert.equal(finalFontSize(selector), token, `${selector} must use ${token}`);
  }

  for (const [name, rule] of [
    ["sidebar details", /\.firm-card small,.section-label\{font-size:var\(--type-label\)/],
    ["sidebar firm name", /\.firm-card b\{font-size:var\(--type-primary\)/],
    ["sidebar firm metadata", /\.firm-card em\{font-size:var\(--type-supporting\)/],
    ["sidebar support", /\.upgrade>b,.upgrade p,.upgrade button\{font-size:var\(--type-supporting\)/],
    ["account copy", /\.account b\{font-size:var\(--type-supporting\)/],
    ["header controls", /\.global-search input,.fy,.add\{font-size:var\(--type-primary\)/],
    ["hero support", /\.pulse-copy>p,.card-head p,.card-head>button\{font-size:var\(--type-supporting\)/],
    ["client metrics", /\.client-metrics small,.portfolio-head\{font-size:var\(--type-label\)/],
    ["portfolio details", /\.entity-cell b\{font-size:var\(--type-primary\)/],
    ["client 360 details", /\.c360-cover small,.c360-cover p,.c360-tabs button,.profile-health span,.detail-label,.detail-grid small/],
  ] as const) {
    assert.match(css, rule, `${name} must use the approved readable scale`);
  }

  for (const selector of [".client small", ".client-metrics small", ".entity-cell small", ".database-error-card small"] as const) {
    const color = finalProperty(selector, "color");
    assert.match(color, /^#[0-9a-f]{6}$/i, `${selector} must use a hex color`);
    assert.ok(contrastRatio(color, "#ffffff") >= 4.5, `${selector} color ${color} must meet WCAG AA contrast`);
  }

  for (const [selector, background] of [
    [".title-row small", "#f5f6fa"],
    [".card-head p", "#ffffff"],
    [".table-labels", "#fafbfc"],
    [".deadline small", "#ffffff"],
    [".clients-title p", "#f5f6fa"],
    [".client-metrics em", "#ffffff"],
    [".portfolio-head", "#fafbfc"],
  ] as const) {
    const color = finalProperty(selector, "color");
    assert.match(color, /^#[0-9a-f]{6}$/i, `${selector} must use a hex color`);
    assert.ok(contrastRatio(color, background) >= 4.5, `${selector} color ${color} must meet WCAG AA contrast on ${background}`);
  }

  for (const [selector, background] of [
    [".title-row>div:first-child>p", "#f5f6fa"],
    [".metrics>button>div:nth-child(2)>span", "#ffffff"],
    [".progress span", "#ffffff"],
    [".empty", "#ffffff"],
    [".donut span", "#ffffff"],
    [".service-list>div>span", "#ffffff"],
    [".portfolio-tools>div button", "#ffffff"],
    [".profile-health span", "#f8f7ff"],
    [".detail-label", "#ffffff"],
    [".section-label", "#101d39"],
    [".firm-card small", "#1a2b4d"],
  ] as const) {
    const color = finalProperty(selector, "color");
    assert.match(color, /^#[0-9a-f]{6}$/i, `${selector} must use a hex color`);
    assert.ok(contrastRatio(color, background) >= 4.5, `${selector} color ${color} must meet WCAG AA contrast on ${background}`);
  }

  for (const [selector, background] of [
    [".logo small", "#111f3e"], [".firm-card em", "#1a2b4d"], [".account small", "#0d1932"], [".upgrade p", "#1c2d52"],
    [".clients-title small", "#f5f6fa"], [".tabs button", "#ffffff"], [".c360-tabs button", "#ffffff"], [".donut small", "#ffffff"],
  ] as const) {
    const color = finalProperty(selector, "color");
    assert.match(color, /^#[0-9a-f]{6}$/i, `${selector} must use a hex color`);
    assert.ok(contrastRatio(color, background) >= 4.5, `${selector} color ${color} must meet WCAG AA contrast on ${background}`);
  }
});

test("cascade resolver handles grouped rules, importance, media, specificity, and source order", () => {
  const fixture = "a,b{font-size:9px}b{font-size:10px!important}@media(max-width:780px){b{font-size:11px!important}}.scope b{font-size:12px}";
  assert.equal(resolveCssProperty(fixture, "b", "font-size", 1440), "10px");
  assert.equal(resolveCssProperty(fixture, "b", "font-size", 375), "11px");
  assert.equal(resolveCssProperty(fixture, ".scope b", "font-size"), "12px");
});
