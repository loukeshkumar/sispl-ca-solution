import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");

const CHAPTER_FILES = ["start", "setup", "practice", "people", "running"].map((part) => `app/manual/chapters-${part}.tsx`);

const manualText = async () =>
  (await Promise.all([...CHAPTER_FILES, "lib/manual/contents.ts"].map(read))).join("\n");

/**
 * Routes that exist but document no workflow. An entry here is a decision that
 * this page has nothing a user needs told; anything else must be in the manual.
 */
const ROUTES_WITHOUT_A_WORKFLOW = new Set(["forbidden"]);

/**
 * A workflow whose states live in a typed union in the code, and the chapter
 * that documents it. Adding a state to one of these fails until the manual
 * names it, which is the whole point: a state nobody documented is a state the
 * firm meets for the first time in production.
 */
const TYPED_WORKFLOWS = [
  { chapter: "app/manual/chapters-people.tsx", source: "lib/payroll/repository.ts", type: "PayrollRunStatus" },
  { chapter: "app/manual/chapters-people.tsx", source: "lib/billing/validation.ts", type: "InvoiceStatus" },
  { chapter: "app/manual/chapters-setup.tsx", source: "lib/procedures/steps.ts", type: "ProcedureStatus" },
];

/** First-level route folders that contain a page anywhere beneath them. */
async function routeFoldersWithAPage() {
  const entries = await readdir(new URL("app/", root), { withFileTypes: true });
  const folders: string[] = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const pending = [`app/${entry.name}`];
    let hasPage = false;
    while (pending.length && !hasPage) {
      const current = pending.pop()!;
      for (const child of await readdir(new URL(`${current}/`, root), { withFileTypes: true })) {
        if (child.isDirectory()) pending.push(`${current}/${child.name}`);
        else if (child.name === "page.tsx") hasPage = true;
      }
    }
    if (hasPage) folders.push(entry.name);
  }
  return folders;
}

test("every sidebar destination is named in the manual", async () => {
  const shell = await read("app/dashboard/dashboard-shell.tsx");
  const labels = [...shell.matchAll(/\{ (?:href: "[^"]+", )?icon: "[^"]+", label: "([^"]+)" \}/g)].map((match) => match[1]);
  assert.ok(labels.length >= 28, `expected the sidebar destinations to be found, got ${labels.length}`);

  const manual = await manualText();
  // The label is compared verbatim: a destination the manual calls something
  // else is one a reader cannot find by the name on their own screen.
  const escaped = (label: string) => label.replace(/&/g, "&amp;");
  for (const label of labels) {
    assert.ok(
      manual.includes(label) || manual.includes(escaped(label)),
      `the sidebar offers "${label}" but the manual never names it — add or update its chapter`,
    );
  }
});

test("every route that holds a page is documented, or declared to hold no workflow", async () => {
  const folders = await routeFoldersWithAPage();
  assert.ok(folders.length >= 12, `expected the route folders to be discovered, got ${folders.length}`);

  const manual = (await manualText()).toLowerCase();
  for (const folder of folders) {
    if (ROUTES_WITHOUT_A_WORKFLOW.has(folder)) continue;
    const spoken = folder.replace(/-/g, " ");
    assert.ok(
      manual.includes(`/${folder}`) || manual.includes(spoken),
      `app/${folder} ships a page the manual never mentions — document it, or add it to ROUTES_WITHOUT_A_WORKFLOW`,
    );
  }
});

test("a documented workflow lists every state the code can be in", async () => {
  for (const workflow of TYPED_WORKFLOWS) {
    const source = await read(workflow.source);
    const declaration = new RegExp(`export type ${workflow.type} =([^;]+);`).exec(source);
    assert.ok(declaration, `${workflow.type} is no longer declared in ${workflow.source}`);

    const states = [...declaration[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    assert.ok(states.length > 1, `${workflow.type} parsed to ${states.length} states`);

    const chapter = await read(workflow.chapter);
    for (const state of states) {
      assert.ok(
        chapter.includes(state),
        `${workflow.type} can be "${state}" but ${workflow.chapter} never says so — update the pipeline`,
      );
    }
  }
});

/**
 * The permission tables are generated. Re-asserted here, beside the coverage
 * rules, because a hand-written table is the one kind of staleness that reads
 * as authoritative.
 */
test("permission tables stay generated rather than transcribed", async () => {
  const chapter = await read("app/manual/chapters-running.tsx");
  assert.match(chapter, /permissionDefinitions\.map/);
  assert.match(chapter, /Object\.entries\(workspacePermissions\)/);
});
