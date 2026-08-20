import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

/** Comments explain the hazards, so assertions about code must not match them. */
const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

test("the native select stays the value the form submits", async () => {
  const source = await read("../app/dashboard/select-search.tsx");
  // Only the menu is replaced. Removing or duplicating the select would break
  // validation, server actions and the browser's own autofill at once.
  const code = withoutComments(source);
  assert.doesNotMatch(code, /\.remove\(\)|removeChild|innerHTML/);
  assert.doesNotMatch(code, /<select/, "the enhancer must not render a second control");
  assert.match(source, /select\.dispatchEvent\(new Event\("change", \{ bubbles: true \}\)\)/);
});

test("a choice reaches React through the prototype setter", async () => {
  const source = await read("../app/dashboard/select-search.tsx");
  /*
   * React caches the last value it wrote and ignores a change event when the
   * DOM still appears to hold it. A plain `select.value = x` is swallowed; the
   * prototype setter bypasses the per-element tracker so onChange runs.
   */
  assert.match(source, /Object\.getOwnPropertyDescriptor\(HTMLSelectElement\.prototype, "value"\)\?\.set/);
  assert.match(source, /setter\.call\(select, value\)/);
  // Both events, because forms in this app listen for either.
  assert.match(source, /new Event\("input", \{ bubbles: true \}\)/);
});

test("only real lists are enhanced, and a control can opt out", async () => {
  const source = await read("../app/dashboard/select-search.tsx");
  assert.match(source, /if \(select\.disabled \|\| select\.multiple \|\| select\.size > 1\) return false/);
  assert.match(source, /if \(mode === "never"\) return false/);
  assert.match(source, /if \(mode === "always"\) return true/);
  assert.match(source, /select\.options\.length >= MIN_OPTIONS/);
  const threshold = source.match(/const MIN_OPTIONS = (\d+)/);
  assert.ok(threshold, "the threshold must be one named constant");
  // High enough that a yes/no stays native, low enough to catch a client list.
  assert.ok(Number(threshold[1]) >= 4 && Number(threshold[1]) <= 8, `MIN_OPTIONS of ${threshold[1]} is outside the useful range`);
});

test("the panel escapes the top layer when its control is inside a modal", async () => {
  const source = await read("../app/dashboard/select-search.tsx");
  // A modal <dialog> paints above every z-index, so a panel appended to <body>
  // would be hidden behind it.
  assert.match(source, /target\.select\.closest\("dialog\[open\]"\) \?\? document\.body/);
  assert.match(source, /createPortal\(panel, host\)/);
});

test("the panel is a combobox and can be driven from the keyboard alone", async () => {
  const source = await read("../app/dashboard/select-search.tsx");
  assert.match(source, /role="combobox"/);
  assert.match(source, /role="listbox"/);
  assert.match(source, /role="option"/);
  assert.match(source, /aria-activedescendant/);
  for (const key of ["ArrowDown", "ArrowUp", "Enter", "Escape", "Tab"]) {
    assert.ok(source.includes(`"${key}"`), `${key} must be handled`);
  }
  // Focus returns to the control it came from, or the tab order is lost.
  assert.match(source, /select\?\.focus\(\{ preventScroll: true \}\)/);
  // Listeners are delegated once, so a select added later needs no registration.
  assert.match(source, /document\.addEventListener\("mousedown", onPointerDown, true\)/);
  assert.match(source, /document\.removeEventListener\("keydown", onKeyDown, true\)/);
});

test("the panel cannot dismiss itself the moment it opens", async () => {
  const source = await read("../app/dashboard/select-search.tsx");
  const code = withoutComments(source);

  /*
   * Focusing the field scrolls it into view unless told otherwise. That scroll
   * was being read as "the page moved", so the panel closed the instant it
   * opened and focus snapped back to the page.
   */
  assert.match(code, /inputRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(code, /inputRef\.current\?\.focus\(\)/, "an unqualified focus scrolls, and that scroll closes the panel");
  // The same applies when focus returns to the control.
  assert.doesNotMatch(code, /select\.focus\(\)/, "returning focus must not scroll either");

  /*
   * A capture-phase scroll listener on `window` receives scrolls from every
   * descendant, including the panel's own option list.
   */
  assert.match(code, /if \(panelRef\.current\?\.contains\(event\.target as Node\)\) return/);
  // Following the control beats dismissing on any movement.
  assert.match(code, /setAnchor\(rect\)/);
  assert.doesNotMatch(code, /const dismiss = \(\) => close\(false\)/);

  // The anchor is separate state, or the effect that writes it would depend on
  // it and re-register its own listeners on every scroll frame.
  assert.match(code, /const \[anchor, setAnchor\] = useState<DOMRect \| null>\(null\)/);
  assert.doesNotMatch(code, /anchor: DOMRect;/);

  /*
   * There must be no covering backdrop element. One appearing between mousedown
   * and mouseup makes the browser fire the click on the nearest common ancestor
   * of the two — inside a modal that is the <dialog>, whose own backdrop-close
   * handler then reads it as "clicked outside" and shuts the whole modal.
   */
  assert.doesNotMatch(code, /select-search-backdrop/, "a covering backdrop retargets the click to the dialog");
  // Dismissal rides the listener that is already there.
  assert.match(code, /if \(openFor\.current && !panelRef\.current\?\.contains\(node\)\)/);
  // And the click it produces is swallowed, so the layer underneath survives.
  assert.match(code, /swallowClick\.current = true/);
  assert.match(code, /document\.addEventListener\("click", onClickCapture, true\)/);
  assert.match(code, /event\.stopPropagation\(\)/);

  // A state updater must stay pure; React may run it twice.
  assert.doesNotMatch(code, /setTarget\(\(current\) => \{[^}]*focus\(/);
});

test("it is mounted once, above every page", async () => {
  const layout = await read("../app/layout.tsx");
  assert.match(layout, /<SelectSearch \/>/);
  // No workspace should be wiring this up for itself.
  const dashboard = await readdir(new URL("dashboard/", new URL("../app/", import.meta.url)));
  const wired = await Promise.all(
    dashboard.filter((file) => file.endsWith(".tsx") && file !== "select-search.tsx")
      .map(async (file) => ({ file, source: await read(`../app/dashboard/${file}`) })),
  );
  for (const { file, source } of wired) {
    assert.doesNotMatch(source, /<SelectSearch/, `${file} must not mount a second enhancer`);
  }
});
