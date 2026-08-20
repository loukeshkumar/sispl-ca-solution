import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const appDirectory = new URL("../app/", import.meta.url);
const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

async function routeSegments(directory: URL, prefix = ""): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = `${prefix}/${entry.name}`;
    found.push(path);
    found.push(...(await routeSegments(new URL(`${entry.name}/`, directory), path)));
  }
  return found;
}

test("record creation and editing happen in dialogs, never on their own route", async () => {
  const segments = await routeSegments(appDirectory);
  const formRoutes = segments.filter((path) => /\/(new|edit)$/.test(path));
  assert.deepEqual(
    formRoutes,
    [],
    `add and edit must open a FormDialog on the workspace that owns the record, not navigate away: ${formRoutes.join(", ")}`,
  );
});

test("the dialog primitive owns focus, escape, and the close contract", async () => {
  const source = await read("../app/dashboard/form-dialog.tsx");
  // The native modal supplies the focus trap, Escape, backdrop, and inert page.
  assert.match(source, /showModal\(\)/);
  assert.match(source, /onClose=\{onClose\}/);
  assert.match(source, /event\.target === dialogRef\.current/, "a backdrop click must close the dialog");
  for (const exported of ["FormDialog", "FormDialogBody", "FormDialogActions", "useCloseOnSuccess"]) {
    assert.match(source, new RegExp(`export (function|const|type) ${exported}`));
  }
});

test("dialog options load on open and surface failure instead of an empty dropdown", async () => {
  const hook = await read("../app/dashboard/use-dialog-options.ts");
  // This previously pinned an `inFlight` re-entry guard, which was the defect:
  // under StrictMode it made the surviving effect invocation bail out and left
  // every options dialog permanently empty. See dialog-options-unit.test.ts.
  assert.match(hook, /if \(!open \|\| loaded\.current\) return/);
  assert.doesNotMatch(hook, /inFlight\.current/);
  assert.match(hook, /failed: true/, "a load failure must be visible, not an empty option list");
  assert.match(hook, /retry/);

  // Every option-backed dialog must offer the retry, or a failed load looks like no data.
  const dialogs = (await readdir(new URL("dashboard/", appDirectory))).filter((file) => file.endsWith("-dialog.tsx"));
  const lazy = await Promise.all(
    dialogs.map(async (file) => ({ file, source: await read(`../app/dashboard/${file}`) })),
  );
  for (const { file, source } of lazy.filter((entry) => entry.source.includes("useDialogOptions"))) {
    assert.match(source, /options\.failed/, `${file} must render a retry when its options fail to load`);
    assert.match(source, /options\.loading/, `${file} must show progress while its options load`);
  }
});

test("dialog saves return state rather than redirecting, so the dialog can close itself", async () => {
  const savers = [
    ["../app/clients/actions.ts", "saveClientAction"],
    ["../app/work/actions.ts", "saveWorkAction"],
    ["../app/tasks/actions.ts", "saveTaskAction"],
    ["../app/team/actions.ts", "saveEmployeeAction"],
    ["../app/packages/actions.ts", "savePackageAction"],
  ] as const;
  for (const [path, action] of savers) {
    const source = await read(path);
    const start = source.indexOf(`export async function ${action}`);
    assert.ok(start >= 0, `${path} must export ${action}`);
    // Line-ending agnostic: with CRLF checkouts an "\n}\n" search misses the
    // closing brace and the slice runs on into the next function.
    const offset = source.slice(start).search(/\r?\n\}\r?\n/);
    const body = source.slice(start, offset >= 0 ? start + offset : undefined);
    assert.doesNotMatch(body, /redirect\(/, `${action} must return state, not navigate the dialog away`);
    assert.match(body, /return \{ error: "", fieldErrors: \{\} \}/);
    assert.match(body, /requirePermission\(/, `${action} must authorize before writing`);
  }
});
