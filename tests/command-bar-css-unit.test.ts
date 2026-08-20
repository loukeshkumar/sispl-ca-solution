import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postcss, { type Rule } from "postcss";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const root = postcss.parse(css);

/** Class/attribute/pseudo count, then element count. Enough for these selectors. */
function specificity(selector: string): number {
  const classes = (selector.match(/\.[a-z0-9-]+/gi) ?? []).length;
  const attributes = (selector.match(/\[[^\]]+\]/g) ?? []).length;
  const pseudoClasses = (selector.match(/:(?!:)[a-z-]+/gi) ?? []).length;
  return classes + attributes + pseudoClasses;
}

/** The upper bound of a rule's media context, or Infinity when unconditional. */
type CssNode = { name?: string; params?: string; parent?: CssNode; type?: string };

function maxWidthOf(rule: Rule): number {
  let node = rule.parent as CssNode | undefined;
  while (node) {
    if (node.type === "atrule" && node.name === "media") {
      const match = node.params?.match(/max-width:\s*(\d+)px/);
      if (match) return Number(match[1]);
    }
    node = node.parent;
  }
  return Infinity;
}

/**
 * Resolves which `display` actually wins for an element carrying `classes`,
 * at a given viewport width.
 *
 * A string search cannot answer this: `.menu-button { display: none }` is
 * present in the file and still loses, because `.icon-button` sets display too,
 * matches the same element, and is declared later at equal specificity.
 */
function winningDisplay(classes: string[], viewport: number): string | null {
  const candidates: Array<{ order: number; specificity: number; value: string }> = [];
  let order = 0;
  root.walkRules((rule) => {
    order += 1;
    if (maxWidthOf(rule) < viewport) return;
    const display = rule.nodes.filter((node) => node.type === "decl" && node.prop === "display").at(-1);
    if (!display) return;
    for (const selector of rule.selectors) {
      const referenced = selector.match(/\.[a-z0-9-]+/gi) ?? [];
      // Only selectors built entirely from classes this element (or an
      // ancestor of it) carries can match it.
      if (!referenced.length) continue;
      if (!referenced.some((token) => classes.includes(token.slice(1)))) continue;
      if (!referenced.every((token) => classes.includes(token.slice(1)))) continue;
      candidates.push({ order, specificity: specificity(selector), value: (display as { value: string }).value });
    }
  });
  if (!candidates.length) return null;
  candidates.sort((a, b) => (a.specificity - b.specificity) || (a.order - b.order));
  return candidates.at(-1)!.value;
}

test("the hamburger and the drawer close button stay hidden on desktop", () => {
  // Both elements carry .icon-button, which also declares display.
  const hamburger = ["command-bar", "menu-button", "icon-button"];
  const closeButton = ["sidebar-content", "sidebar-close", "icon-button"];

  assert.equal(winningDisplay(hamburger, 1440), "none", "the hamburger must not show beside an open sidebar");
  assert.equal(winningDisplay(closeButton, 1440), "none", "nothing to close when the sidebar is permanent");
  assert.equal(winningDisplay(hamburger, 1280), "none");
  assert.equal(winningDisplay(closeButton, 1280), "none");
  assert.equal(winningDisplay(hamburger, 1024), "none", "1024px is the first desktop width");
});

test("both return below the drawer breakpoint, where the sidebar is an overlay", () => {
  const hamburger = ["command-bar", "menu-button", "icon-button"];
  const closeButton = ["sidebar-content", "sidebar-close", "icon-button"];

  assert.equal(winningDisplay(hamburger, 900), "inline-flex", "the drawer needs a way to open");
  assert.equal(winningDisplay(closeButton, 900), "inline-flex", "and a way to close");
  assert.equal(winningDisplay(hamburger, 390), "inline-flex");
});

test("a hidden control is never left to win on source order alone", () => {
  // .icon-button is the shared rule these collided with; any control hidden by
  // default must out-rank it rather than merely precede or follow it.
  const shared = root.nodes.filter((node): node is Rule => node.type === "rule" && node.selector === ".icon-button");
  assert.equal(shared.length, 1, "expected exactly one .icon-button base rule");
  const sharedSpecificity = specificity(".icon-button");

  for (const selector of [".command-bar .menu-button", ".sidebar-content .sidebar-close"]) {
    assert.ok(
      specificity(selector) > sharedSpecificity,
      `${selector} must out-rank .icon-button, not depend on where it sits in the file`,
    );
  }
});
