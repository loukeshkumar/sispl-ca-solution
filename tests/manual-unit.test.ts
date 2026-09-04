import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { hasPermission, permissionDefinitions, roles } from "../lib/auth/authorization";
import { manualChapter, manualParts, manualSections } from "../lib/manual/contents";
import { openWorkspaces, workspacePermissions } from "../lib/dashboard/navigation";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

const CHAPTER_FILES = [
  "../app/manual/chapters-start.tsx",
  "../app/manual/chapters-setup.tsx",
  "../app/manual/chapters-practice.tsx",
  "../app/manual/chapters-people.tsx",
  "../app/manual/chapters-running.tsx",
];

async function renderedChapterIds() {
  const sources = await Promise.all(CHAPTER_FILES.map(read));
  return sources.flatMap((source) => [...source.matchAll(/<Chapter id="([^"]+)">/g)].map((match) => match[1]));
}

/**
 * The contents and the chapters are two lists that must stay one list.
 *
 * A chapter written without an entry has no number and no way to be reached
 * from the rail; an entry with no chapter is a contents link to nothing.
 */
test("every contents entry has a chapter, and every chapter an entry", async () => {
  const rendered = await renderedChapterIds();
  assert.ok(rendered.length >= 29, `expected the chapters to be found, got ${rendered.length}`);

  const listed = new Set(manualSections.map((section) => section.id));
  for (const id of rendered) assert.ok(listed.has(id), `chapter "${id}" is rendered but missing from the contents`);
  for (const section of manualSections) {
    assert.ok(rendered.includes(section.id), `"${section.id}" is in the contents but no chapter renders it`);
  }
});

test("chapters appear in the order the contents promises", async () => {
  assert.deepEqual(await renderedChapterIds(), manualSections.map((section) => section.id));
});

test("chapter ids are unique, so an anchor lands on one place", () => {
  const ids = manualSections.map((section) => section.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate chapter id");
  for (const id of ids) assert.match(id, /^[a-z][a-z-]*$/, `"${id}" is not a usable anchor`);
});

test("numbering runs unbroken from one across the parts", () => {
  manualSections.forEach((section, index) => {
    assert.equal(manualChapter(section.id).number, index + 1);
  });
  assert.ok(manualParts.every((part) => part.sections.length > 0), "a part with no chapters renders an empty heading");
});

test("an unknown chapter fails loudly rather than rendering blank", () => {
  assert.throws(() => manualChapter("not-a-chapter"), /Unknown manual chapter/);
});

/**
 * The permission tables are generated, not transcribed. These assertions keep
 * the sources they read from present, so the page cannot quietly fall back to
 * describing rules the product no longer enforces.
 */
test("the manual renders its permission tables from the enforced definitions", async () => {
  const source = await read("../app/manual/chapters-running.tsx");

  assert.match(source, /permissionDefinitions/);
  assert.match(source, /hasPermission\(role, permission\.key\)/);
  assert.match(source, /workspacePermissions/);
  assert.match(source, /openWorkspaces/);

  // Nothing hand-written can be describing the matrix instead.
  assert.doesNotMatch(source, /dashboard:read<\/code>/, "a transcribed permission row will drift from the definitions");

  assert.ok(permissionDefinitions.length > 0);
  assert.ok(roles.every((role) => hasPermission(role, "dashboard:read")), "every role opens the workspace");
});

test("the manual is a destination the sidebar routes to and every role can open", async () => {
  const shell = await read("../app/dashboard/dashboard-shell.tsx");

  assert.match(shell, /\{ href: "\/manual", icon: "[^"]+", label: "Manual" \}/);
  assert.ok(openWorkspaces.has("Manual"), "the manual must be readable by every signed-in role");
  assert.ok(!("Manual" in workspacePermissions), "gating the manual hides it from the role that needs it most");

  const layout = await read("../app/manual/layout.tsx");
  assert.match(layout, /WorkspaceRouteFrame active="Manual"/);
});
