import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postcss from "postcss";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const compact = css.toLowerCase().replace(/\s+/g, "");
const parsed = postcss.parse(css);

// The palette is the Ledger identity: indigo chrome, saffron accent, and a hue
// per part of the firm. These assertions are the design contract, not incidental.
test("light and dark themes expose one premium glass token contract", () => {
  assert.match(css, /@import\s+"tailwindcss"/);
  assert.ok(compact.includes("--accent:#f59e0b"));
  assert.ok(compact.includes("[data-theme=\"dark\"]{"));
  assert.ok(compact.includes("--canvas:#0e1024"));
  assert.ok(compact.includes("--glass-surface:rgba(255,255,255,.055)"));
  assert.ok(compact.includes("--glass-strong:rgba(23,26,53,.88)"));
  assert.ok(compact.includes("--glass-border:rgba(255,255,255,.1)"));
  assert.ok(compact.includes("backdrop-filter:blur(24px)"));
  assert.match(compact, /\.dashboard-workspace::before\{[^}]*radial-gradient/);
});

test("premium surfaces, analytics, and interactions remain responsive and accessible", () => {
  assert.match(compact, /\.overview-analytics\{[^}]*display:grid/);
  assert.match(compact, /\.overview-kpi-grid\{[^}]*grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
  assert.match(compact, /\.surface-card\{[^}]*backdrop-filter:blur\(24px\)/);
  assert.match(compact, /button\.kpi-card:hover[^}]*translatey\(-2px\)/);
  assert.ok(compact.includes("--control-height:44px"));

  for (const query of ["(max-width:1439px)", "(max-width:1023px)", "(max-width:767px)"]) {
    assert.ok(parsed.nodes.some((node) => node.type === "atrule" && node.name === "media" && node.params.replace(/\s+/g, "") === query), `missing ${query}`);
  }
  assert.match(compact, /@media\(prefers-reduced-motion:reduce\)[\s\S]*transform:none!important/);
  assert.match(compact, /\.portfolio-row\{[^}]*background:var\(--row-surface\)/);
  assert.match(compact, /\.portfolio-row\[aria-pressed="true"\]\{[^}]*background:var\(--row-selected\)/);
  assert.ok(compact.includes("--focus-ring:#4f46e5"));
  assert.match(compact, /\[data-theme="dark"\]\{[\s\S]*--focus-ring:#fbbf24/);
  for (const token of ["--status-red-ink", "--status-amber-ink", "--status-blue-ink", "--status-mint-ink"]) {
    assert.ok(compact.includes(token), `missing ${token}`);
  }
  assert.match(compact, /\.portfolio-identityem\{[^}]*color:var\(--client-meta-ink\)/);
  // Every part of the firm carries its own hue, in both themes.
  for (const hue of ["--hue-practice", "--hue-delivery", "--hue-clients", "--hue-revenue", "--hue-firm"]) {
    assert.ok(compact.includes(`${hue}:#`), `missing ${hue}`);
    const darkBlock = compact.slice(compact.indexOf('[data-theme="dark"]{'));
    assert.ok(darkBlock.includes(`${hue}:#`), `${hue} must be re-tuned for dark`);
  }
  assert.match(compact, /\.portfolio-servicesi\{[^}]*color:var\(--service-chip-ink\)/);
});

test("glass surfaces actually frost: translucent, prefixed, and over something", () => {
  // A near-opaque surface silently disables the blur — the effect is still
  // declared, so nothing errors and the page just looks flat.
  const lightGlass = css.match(/--glass-surface:\s*rgba\(255,\s*255,\s*255,\s*\.(\d+)\)/);
  assert.ok(lightGlass, "light theme must define --glass-surface");
  assert.ok(Number(`0.${lightGlass[1]}`) <= 0.85, `--glass-surface is ${lightGlass[1]}: too opaque to frost anything`);

  const lightStrong = css.match(/--glass-strong:\s*rgba\(255,\s*255,\s*255,\s*\.(\d+)\)/);
  assert.ok(lightStrong && Number(`0.${lightStrong[1]}`) <= 0.9, "--glass-strong must stay translucent");

  // Safari needs the prefix; without it glass never renders there at all.
  const prefixed = (css.match(/-webkit-backdrop-filter:/g) ?? []).length;
  const plain = (css.match(/(?<!-webkit-)backdrop-filter:/g) ?? []).length;
  assert.equal(prefixed, plain, "every backdrop-filter needs a -webkit- counterpart for Safari");

  // Every var() must resolve, or the whole declaration is dropped at compute time.
  const defined = new Set([...css.matchAll(/^\s+(--[a-z-]+):/gm)].map((match) => match[1]));
  // Supplied by an inline style at the point of use, like the hues above.
  const inherited = new Set(["--font-geist-sans", "--font-geist-mono", "--section-hue", "--skeleton-columns", "--kpi-hue", "--ring-colour", "--ring-value"]);
  for (const [, token] of css.matchAll(/var\((--[a-z-]+)(?=[),])/g)) {
    assert.ok(defined.has(token) || inherited.has(token), `${token} is used but never defined`);
  }

  // A shell that frosts a flat fill frosts to the same flat fill.
  for (const shell of [".login-shell", ".portal-shell"]) {
    const block = css.slice(css.indexOf(`${shell} {`), css.indexOf("}", css.indexOf(`${shell} {`)));
    assert.match(block, /radial-gradient/, `${shell} needs a backdrop worth blurring`);
  }
});
