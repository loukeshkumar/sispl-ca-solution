import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

/**
 * A route with an href in the sidebar renders its own `<main>`, so the shell
 * and the highlight can only come from a layout. Two ways this has gone wrong:
 * four settings routes shipped with no frame at all and lost the sidebar, and
 * every route under /team inherited one parent frame saying "Employees", so
 * Training & CPE highlighted the wrong item.
 */
test("every routed sidebar destination mounts a frame that names it", async () => {
  const shell = await read("../app/dashboard/dashboard-shell.tsx");
  const navLabels = new Set([...shell.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]));
  const destinations = [...shell.matchAll(/href: "(\/[^"]+)", icon: "[^"]+", label: "([^"]+)"/g)]
    .map((match) => ({ href: match[1], label: match[2] }));
  assert.ok(destinations.length >= 8, `expected the routed destinations to be found, got ${destinations.length}`);

  for (const destination of destinations) {
    const layout = await read(`../app${destination.href}/layout.tsx`).catch(() => "");
    const active = /WorkspaceRouteFrame active="([^"]+)"/.exec(layout);
    assert.ok(active, `${destination.href} has no WorkspaceRouteFrame layout of its own`);
    assert.equal(
      active[1],
      destination.label,
      `${destination.href} highlights "${active[1]}" but the sidebar links it as "${destination.label}"`,
    );
    assert.ok(navLabels.has(active[1]), `"${active[1]}" is not a sidebar destination`);
  }
});

/**
 * Every settings route needs a frame, including the ones the sidebar does not
 * link to directly.
 */
test("every settings route renders inside the workspace frame", async () => {
  const settings = new URL("../app/settings/", import.meta.url);
  const entries = await readdir(settings, { withFileTypes: true });
  const routes = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const files = await readdir(new URL(`${entry.name}/`, settings));
    if (files.includes("page.tsx")) routes.push(entry.name);
  }
  assert.ok(routes.length >= 7, "expected the settings routes to be discovered");

  const shellSource = await read("../app/dashboard/dashboard-shell.tsx");
  const labels = new Set([...shellSource.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]));

  for (const route of routes) {
    const layout = await read(`../app/settings/${route}/layout.tsx`).catch(() => "");
    const active = /WorkspaceRouteFrame active="([^"]+)"/.exec(layout);
    assert.ok(active, `app/settings/${route} has no WorkspaceRouteFrame layout, so it loses the sidebar`);
    assert.ok(labels.has(active[1]), `"${active[1]}" is not a sidebar destination, so ${route} highlights nothing`);
  }
});

/**
 * A parent frame would wrap every child route with one label and nest a second
 * shell inside any child that mounts its own.
 */
test("a parent layout over routed destinations stays a pass-through", async () => {
  const teamLayout = await read("../app/team/layout.tsx");
  assert.doesNotMatch(teamLayout, /WorkspaceRouteFrame/, "app/team/layout.tsx must not frame every team route");
});


/**
 * The sidebar renders a page destination as a link, but the palette and the `g`
 * jumps only report its label. Resolving that label against the navigation tree
 * keeps every destination reachable from both.
 */
test("destinations that are pages resolve to their own route", async () => {
  const [shell, workspaceShell, client] = await Promise.all([
    read("../app/dashboard/dashboard-shell.tsx"),
    read("../app/authenticated-workspace-shell.tsx"),
    read("../app/dashboard-client.tsx"),
  ]);
  assert.match(shell, /export const destinationRoutes/);
  assert.match(workspaceShell, /destinationRoutes\[destination\]/);
  assert.match(client, /destinationRoutes\[destination\]/);

  const hrefs = [...shell.matchAll(/href: "([^"]+)", icon: "[^"]+", label: "([^"]+)"/g)];
  assert.ok(hrefs.length >= 6, "expected the navigation to carry page destinations");
});
