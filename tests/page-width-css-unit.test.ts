import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import postcss, { type Rule } from "postcss";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const root = postcss.parse(css);

const SHELLS = [
  "client-page-shell",
  "client-360-shell",
  "work-360-shell",
  "employee-360-shell",
  "task-360-shell",
  "package-route-page",
  "billing-page-shell",
  "role-page-shell",
];

type CssNode = { name?: string; params?: string; parent?: CssNode; type?: string };

function insideNarrowMedia(rule: Rule): boolean {
  let node = rule.parent as CssNode | undefined;
  while (node) {
    if (node.type === "atrule" && node.name === "media") {
      const match = node.params?.match(/max-width:\s*(\d+)px/);
      if (match && Number(match[1]) < 1440) return true;
    }
    node = node.parent;
  }
  return false;
}

function specificity(selector: string): number {
  return (selector.match(/[.#[:]/g) ?? []).length;
}

/**
 * Resolves the declaration that actually applies to a shell nested inside the
 * workspace canvas, at desktop width.
 *
 * Asserting the new rule is merely present would prove nothing: the old caps
 * are still in the file, and one of them winning is exactly the bug.
 */
function winning(shell: string, property: string): string | null {
  const candidates: Array<{ order: number; specificity: number; value: string }> = [];
  let order = 0;
  root.walkRules((rule) => {
    order += 1;
    if (insideNarrowMedia(rule)) return;
    const declaration = rule.nodes.filter((node) => node.type === "decl" && node.prop === property).at(-1);
    if (!declaration) return;
    for (const selector of rule.selectors) {
      const classes = selector.match(/\.[a-z0-9-]+/gi)?.map((token) => token.slice(1)) ?? [];
      if (!classes.includes(shell)) continue;
      // Only selectors this element actually matches when nested in the canvas.
      if (!classes.every((name) => name === shell || name === "workspace-route-content")) continue;
      candidates.push({ order, specificity: specificity(selector), value: (declaration as { value: string }).value });
    }
  });
  if (!candidates.length) return null;
  candidates.sort((a, b) => (a.specificity - b.specificity) || (a.order - b.order));
  return candidates.at(-1)!.value;
}

test("every routed page resolves to the same measure", () => {
  for (const shell of SHELLS) {
    assert.equal(
      winning(shell, "max-width"),
      "var(--content-max)",
      `${shell} must share one page width, not keep its own cap`,
    );
  }
});

test("the canvas owns the side padding, so shells add none of their own", () => {
  for (const shell of SHELLS) {
    for (const side of ["padding-left", "padding-right"]) {
      const value = winning(shell, side);
      assert.ok(value === "0" || value === null, `${shell} must not double the canvas padding on ${side} (got ${value})`);
    }
  }
});

test("one measure is declared once, and leaves room to use the screen", () => {
  const token = css.match(/--content-max:\s*(\d+)px/);
  assert.ok(token, "--content-max must be defined");
  const width = Number(token[1]);
  // Wide enough to use a laptop screen beside the sidebar, bounded so a table
  // does not sprawl across an ultrawide monitor.
  assert.ok(width >= 1400 && width <= 1800, `--content-max of ${width}px is outside the useful range`);
});

test("detail asides grow with the page instead of squeezing their forms", () => {
  for (const grid of ["work-360-grid", "task-360-grid", "client-360-grid"]) {
    const value = winning(grid, "grid-template-columns");
    assert.ok(value?.includes("minmax(300px"), `${grid} aside must have a floor and a share, not a fixed width (got ${value})`);
  }
  // Three fixed columns inside a narrow aside is what truncated the labels.
  const form = winning("filing-ack-form", "grid-template-columns");
  assert.match(String(form), /auto-fit/, "acknowledgement fields must wrap to the room available");
});
