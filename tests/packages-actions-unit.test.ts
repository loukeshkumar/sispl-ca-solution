import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { databaseErrorCode } from "../lib/packages/errors";

test("package Server Actions validate and authorize every commercial mutation", async () => {
  const source = await readFile(new URL("../app/packages/actions.ts", import.meta.url), "utf8");
  for (const action of [
    "saveServiceAction", "savePackageAction", "loadPackageFormOptions",
    "loadClientPackageWorkspace", "assignClientPackageAction", "cancelClientPackageAction",
  ]) assert.match(source, new RegExp(`export async function ${action}`));
  // Package add/edit moved into a dialog; one save handles both, keyed on packageId.
  assert.match(source, /const packageId = UUID_PATTERN\.test\(rawId\) \? rawId : null/);
  assert.match(source, /requirePermission\("packages:manage"/);
  assert.match(source, /requirePermission\("client_packages:manage"/);
  assert.match(source, /validateServiceFields/);
  assert.match(source, /validatePackageFields/);
  assert.match(source, /validateAssignmentFields/);
  assert.match(source, /revalidatePath\("\/"\)/);
  assert.doesNotMatch(source, /export const /, 'a "use server" module may export only async functions');
  assert.doesNotMatch(source, /return \{[^}]*error\.message/);
});

test("package conflict mapping reads wrapped PostgreSQL errors without exposing messages", () => {
  const databaseError = Object.assign(new Error("duplicate"), { code: "23505" });
  assert.equal(databaseErrorCode(new Error("query failed", { cause: databaseError })), "23505");
  assert.equal(databaseErrorCode(new Error("unclassified")), "");
});
