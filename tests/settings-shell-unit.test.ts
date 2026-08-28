import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

/**
 * A settings route renders its own `<main>`, so the sidebar and command bar can
 * only come from a layout. Four routes shipped without one and rendered as a
 * bare page, which is invisible until someone opens that URL.
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

  const shell = await read("../app/dashboard/dashboard-shell.tsx");
  const navLabels = new Set([...shell.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]));

  for (const route of routes) {
    const layout = await read(`../app/settings/${route}/layout.tsx`).catch(() => "");
    const active = /WorkspaceRouteFrame active="([^"]+)"/.exec(layout);
    assert.ok(active, `app/settings/${route} has no WorkspaceRouteFrame layout, so it loses the sidebar`);
    assert.ok(navLabels.has(active[1]), `"${active[1]}" is not a sidebar destination, so ${route} highlights nothing`);
  }
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
