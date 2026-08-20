import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

import { toastMessageFor, toastMessages } from "../lib/ui/toast-messages";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("a toast key from the URL is resolved against an allow-list, never rendered raw", () => {
  assert.equal(toastMessageFor("work-completed"), "Work item completed.");
  assert.equal(toastMessageFor("not-a-real-key"), null);
  assert.equal(toastMessageFor(""), null);
  assert.equal(toastMessageFor(null), null);
  // A crafted link must not be able to put words in the application's mouth.
  assert.equal(toastMessageFor("Your account was closed. Call 1800-000-000."), null);
  // Nor reach through the prototype for a value that is not a message.
  assert.equal(toastMessageFor("toString"), null);
  assert.equal(toastMessageFor("constructor"), null);
  for (const message of Object.values(toastMessages)) assert.match(message, /\.$/, "each confirmation is a sentence");
});

test("every toast key a Server Action redirects with has a message", async () => {
  const actionFiles = ["attendance", "billing", "clients", "documents", "packages", "tasks", "team", "work"];
  const sources = await Promise.all(actionFiles.map((name) => read(`../app/${name}/actions.ts`)));
  const used = new Set<string>();
  for (const source of sources) {
    // A key runs up to a quote, an ampersand, or the `${` of an interpolation.
    for (const [, key, delimiter] of source.matchAll(/toast=([a-z-]+?)(["'`&]|\$\{)/g)) {
      if (delimiter === "${") {
        // Assembled from a stem plus a branch, e.g. toast=task-${completed|cancelled}.
        const stem = key.replace(/-$/, "");
        const branches = Object.keys(toastMessages).filter((message) => message.startsWith(`${stem}-`));
        assert.ok(branches.length > 0, `no messages defined for the "${stem}-" family`);
        continue;
      }
      used.add(key);
    }
  }
  assert.ok(used.size > 0, "actions must confirm what they did");
  for (const key of used) {
    assert.ok(toastMessageFor(key), `redirect uses toast=${key} but no message is defined`);
  }
});

test("the toast region is a live region that exists before it has content", async () => {
  const source = await read("../app/dashboard/toast.tsx");
  assert.match(source, /className="toast-region"/);
  assert.match(source, /aria-live=\{toast\.tone === "error" \? "assertive" : "polite"\}/);
  assert.match(source, /aria-label="Dismiss notification"/);
  // The region must render whether or not toasts exist, or nothing is announced.
  assert.doesNotMatch(source, /toasts\.length &&/);
  assert.match(source, /clearTimeout/, "pending dismiss timers must be cleaned up");
  // The confirmation is stripped so a refresh or a shared link cannot replay it.
  assert.match(source, /remaining\.delete\("toast"\)/);
});

test("skeletons are decorative and route fallbacks announce the wait", async () => {
  const skeleton = await read("../app/dashboard/skeleton.tsx");
  assert.match(skeleton, /aria-hidden="true"/);
  assert.match(skeleton, /role="status"/);
  assert.match(skeleton, /<span className="sr-only">Loading/);

  const css = await read("../app/globals.css");
  // Line-ending agnostic: git checks this file out with CRLF on Windows, and a
  // rule is no less present for it.
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\r?\n {2}\.skeleton \{ animation: none; \}/);

  // Every heavy route gets a fallback, or navigation shows a blank frame.
  for (const route of ["app", "app/clients/[clientId]", "app/work/[workItemId]", "app/tasks/[taskId]", "app/team/[employeeId]", "app/billing/[invoiceId]", "app/settings/master-data"]) {
    const files = await readdir(new URL(`../${route}/`, import.meta.url));
    assert.ok(files.includes("loading.tsx"), `${route} must ship a loading fallback`);
  }
});

test("an empty region says what is missing and what to do next", async () => {
  const source = await read("../app/dashboard/dashboard-ui.tsx");
  assert.match(source, /export function EmptyState/);
  assert.match(source, /className="empty-state-icon"/);

  // A bare sentence in a div is the state this replaced; it must not come back.
  const workspaces = (await readdir(new URL("../app/dashboard/", import.meta.url))).filter((file) => file.endsWith(".tsx"));
  for (const file of workspaces) {
    const contents = await read(`../app/dashboard/${file}`);
    assert.doesNotMatch(
      contents,
      /className="empty-state">[A-Za-z]/,
      `${file} must use <EmptyState> so the reader learns why the region is empty`,
    );
  }
});

test("keyboard shortcuts stay out of the way of typing and of open dialogs", async () => {
  const source = await read("../app/dashboard/command-palette.tsx");
  assert.match(source, /\["INPUT", "SELECT", "TEXTAREA"\]\.includes\(target\.tagName\)/);
  assert.match(source, /target\.isContentEditable/);
  assert.match(source, /if \(typing \|\| event\.ctrlKey \|\| event\.metaKey \|\| event\.altKey\) return/);
  assert.match(source, /document\.querySelector\("dialog\[open\]"\)/, "a single-key shortcut must not fire behind a modal");
  assert.match(source, /event\.key\.toLowerCase\(\) === "k"/);
  assert.match(source, /removeEventListener\("keydown", handler\)/);
  // The palette is a listbox, so arrow keys and Enter behave as expected.
  assert.match(source, /role="listbox"/);
  assert.match(source, /role="option"/);
  assert.match(source, /aria-activedescendant/);
});

test("people operations live under one parent, and the palette still reaches them", async () => {
  const shell = await read("../app/dashboard/dashboard-shell.tsx");
  const people = shell.slice(shell.indexOf('        icon: "team",'), shell.indexOf('label: "Employee Management"'));
  for (const label of ["Employees", "Attendance", "Salary", "Timesheets"]) {
    assert.match(people, new RegExp(`label: "${label}"`), `${label} belongs under Employee Management`);
  }

  // The masters that configure people are configuration, so they sit with the
  // other masters rather than beside the workspaces they drive.
  const settings = shell.slice(shell.indexOf('        icon: "settings",'), shell.indexOf('label: "Settings"'));
  for (const label of ["Service Management", "Master Data", "Attendance Masters", "User Roles Management"]) {
    assert.match(settings, new RegExp(`label: "${label}"`), `${label} belongs under Settings`);
  }
  for (const label of ["Attendance Masters", "User Roles Management"]) {
    assert.doesNotMatch(people, new RegExp(`label: "${label}"`), `${label} must not also sit under Employee Management`);
  }
  // The parent only toggles, so its label must not collide with a routing label.
  assert.doesNotMatch(shell, /active === "Employee Management"/);

  // Grouping must not hide a destination from search or from a g-jump.
  assert.match(shell, /export const paletteDestinations/);
  // Flattened twice: sections down to entries, then groups down to their leaves.
  assert.match(shell, /navigation\.flatMap\(\(section\) => section\.entries\)/);
  assert.match(shell, /allEntries\.flatMap\(\(entry\) => \(isGroup\(entry\) \? entry\.items : \[entry\]\)\)/);
  assert.match(shell, /destinations=\{paletteDestinations\}/);

  // Every workspace the sidebar can reach must still resolve to a URL.
  const authenticatedShell = await read("../app/authenticated-workspace-shell.tsx");
  for (const label of ["Employees", "Attendance", "Salary", "Timesheets", "User Roles Management"]) {
    assert.match(authenticatedShell, new RegExp(`"?${label}"?: "/`), `${label} needs a destination URL`);
  }
});

test("the sidebar rail stays usable: escape hatch, labels, and drawer exemption", async () => {
  const [shell, script, css] = await Promise.all([
    read("../app/dashboard/dashboard-shell.tsx"),
    read("../app/dashboard/sidebar-script.tsx"),
    read("../app/globals.css"),
  ]);

  // The width is applied before paint, so the workspace never jumps on hydration.
  assert.match(script, /data-sidebar/);
  assert.match(script, /localStorage\.getItem\("sispl-sidebar"\)/);
  assert.match(shell, /useSyncExternalStore\(subscribeSidebar, readSidebarMode, readServerSidebarMode\)/);
  assert.match(shell, /function readServerSidebarMode\(\) \{\n {2}return false;/);

  // Collapsed, an icon has no words, so every rail control names itself.
  assert.match(shell, /className="sidebar-tooltip"/);
  assert.match(shell, /aria-hidden="true" className="sidebar-tooltip"/, "the control already has an accessible name");
  assert.match(css, /\.sidebar-tooltip \{[\s\S]*?position: fixed;/, "a scrolling menu would clip an absolute label");

  // Without a visible toggle in the rail there is no way back to the labels.
  assert.doesNotMatch(css, /:root\[data-sidebar="rail"\][^{]*\.sidebar-collapse-toggle[^{]*\{\s*display: none/);
  assert.match(shell, /aria-label=\{collapsed \? "Expand sidebar" : "Collapse sidebar"\}/);
  assert.match(shell, /aria-pressed=\{collapsed\}/);

  // The rail preference must not reach the mobile drawer, which has room for labels.
  const railBlock = css.slice(css.indexOf("@media (min-width: 1024px)"));
  assert.ok(railBlock.includes('[data-sidebar="rail"]'), "rail styling is scoped above the drawer breakpoint");

  // The menu scrolls on its own so the account and sign-out stay reachable.
  assert.match(css, /\.sidebar-content \{[\s\S]*?grid-template-rows: auto minmax\(0, 1fr\) auto;/);
  assert.match(shell, /className="sidebar-foot"/);

  // Arrow keys are an addition to Tab, and skip whatever is currently hidden.
  assert.match(shell, /\["ArrowDown", "ArrowUp", "Home", "End"\]\.includes\(event\.key\)/);
  assert.match(shell, /\.filter\(\(item\) => item\.offsetParent !== null\)/);
});
