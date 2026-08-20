import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("search entitlement is decided on the server, never sent by the browser", async () => {
  const [action, component] = await Promise.all([
    read("../app/search/actions.ts"),
    read("../app/dashboard/global-search.tsx"),
  ]);
  // The action takes only the query; what may be seen comes from the session.
  assert.match(action, /export async function searchAction\(query: string\)/);
  assert.match(action, /requirePermission\("dashboard:read"\)/);
  assert.match(action, /session\.tenantId/);
  for (const permission of ["billing:read", "documents:read", "tasks:read", "team:read"]) {
    assert.ok(action.includes(`hasPermission(session, "${permission}")`), `${permission} must be checked server-side`);
  }
  // The client must not be able to widen its own scope.
  assert.doesNotMatch(component, /searchAction\([^)]*allowed/);
  assert.match(component, /searchAction\(term\)/);
});

test("every search branch is tenant-scoped and hides unentitled groups entirely", async () => {
  const source = await read("../lib/search/repository.ts");
  const branches = source.split(/if \(allowed\./).slice(1);
  assert.equal(branches.length, 6, "one branch per record type");
  for (const branch of branches) {
    assert.match(branch, /tenantId\b/, "a branch that does not scope by tenant would cross firms");
    assert.match(branch, /PER_GROUP_LIMIT/, "each group must be bounded");
  }
  // Unentitled groups are not queried at all rather than queried and filtered.
  assert.match(source, /const queries: Array<Promise<SearchHit\[\]>> = \[\]/);

  // People resolve through membership; the users table itself is global.
  assert.match(source, /innerJoin\(tenantMemberships, eq\(tenantMemberships\.userId, users\.id\)\)/);
  assert.match(source, /eq\(tenantMemberships\.tenantId, tenantId\)/);
});

test("search never selects identifiers that must not leak into a result list", async () => {
  const source = await read("../lib/search/repository.ts");
  for (const field of ["maskedPan", "mobileNumber", "gstin", "panNumber", "aadhaar"]) {
    assert.doesNotMatch(source, new RegExp(`\b${field}\b`), `${field} must never reach a search result`);
  }
});

test("a query cannot inject a LIKE pattern", async () => {
  const source = await read("../lib/search/repository.ts");
  assert.match(source, /function likeTerm/);
  assert.ok(source.includes("term.replace(/[\\\\%_]/g"), "%, _ and backslash must be escaped");
  assert.match(source, /term\.slice\(0, 80\)/, "an unbounded pattern is a denial-of-service");
  assert.match(source, /if \(term\.length < 2\) return \[\]/);
});

test("the header offers only what the viewer may actually create", async () => {
  const source = await read("../app/dashboard/create-menu.tsx");
  assert.match(source, /hasPermission\(viewer, entry\.permission\)/);
  for (const permission of ["clients:write", "work:write", "tasks:assign", "documents:write", "billing:manage", "team:manage"]) {
    assert.ok(source.includes(`"${permission}"`), `${permission} entry must be permission-gated`);
  }
  // No create rights means no button, rather than a button that always refuses.
  assert.match(source, /if \(!available\.length\) return null;/);
});
