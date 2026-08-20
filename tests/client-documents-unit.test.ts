import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { canViewInline, INLINE_VIEWABLE } from "../lib/documents/library";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

test("only inert file types are ever previewed in the browser", () => {
  for (const safe of ["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"]) {
    assert.ok(canViewInline(safe), `${safe} should be previewable`);
  }
  // A file served inline runs in this origin. These can carry script, so they
  // are download-only however they are labelled.
  for (const dangerous of ["text/html", "image/svg+xml", "application/xhtml+xml", "text/xml", "application/xml", "text/javascript", "application/javascript", "application/octet-stream"]) {
    assert.ok(!canViewInline(dangerous), `${dangerous} must never be served inline`);
  }
  // Case and padding must not be a way past the allow-list.
  assert.ok(canViewInline("APPLICATION/PDF"));
  assert.ok(!canViewInline("text/HTML"));
  assert.equal(INLINE_VIEWABLE.has("image/svg+xml"), false);
});

test("the view route hardens inline delivery", async () => {
  const source = await read("../app/documents/[documentId]/view/route.ts");
  assert.match(source, /authorizeRoutePermission\("documents:read"\)/);
  assert.match(source, /session\.tenantId/, "a document is only readable within its own firm");

  // Refused rather than downgraded: an unlisted type never reaches the browser.
  assert.match(source, /if \(!canViewInline\(mimeType\)\)/);
  assert.match(source, /status: 415/);

  // The served type comes from the allow-listed value, not the stored string,
  // so a mislabelled upload cannot choose its own handler.
  assert.match(source, /"Content-Type": mimeType/);
  assert.match(source, /"X-Content-Type-Options": "nosniff"/);
  assert.match(source, /sandbox/);
  assert.match(source, /script-src 'none'/);

  // Bytes are re-hashed before serving, as the download route does.
  assert.match(source, /createHash\("sha256"\)/);
  assert.match(source, /status: 410/);
});

test("the library lists only committed files, scoped to the firm", async () => {
  const source = await read("../lib/documents/library.ts");
  assert.match(source, /eq\(documents\.tenantId, tenantId\)/);
  assert.match(source, /eq\(legalEntities\.tenantId, tenantId\)/);
  /*
   * The status literal is checked against the schema rather than hard-coded
   * here. A previous version of this test asserted "stored" — a value no row
   * can ever hold — so the query silently returned nothing and the test agreed
   * with it. Deriving the allowed set means an invented status cannot pass.
   */
  const schema = await read("../db/schema.ts");
  const constraint = schema.match(/documents_status_check[^`]*`\$\{table\.status\} in \(([^)]*)\)/);
  assert.ok(constraint, "documents must constrain its status in the schema");
  const allowed = [...constraint[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
  assert.deepEqual(allowed.sort(), ["pending", "ready"]);

  const used = source.match(/eq\(documents\.status, "([a-z_]+)"\)/);
  assert.ok(used, "the library must filter on a document status");
  assert.ok(allowed.includes(used[1]), `status "${used[1]}" is not one the schema permits`);
  // A pending row is a staged upload that has not passed its integrity check;
  // listing one offers a download that cannot be served.
  assert.equal(used[1], "ready", "only committed uploads belong in the library");
  // Storage names are internal and must not reach the browser.
  assert.doesNotMatch(source, /storageName/, "the storage path must not leak into a listing");
});

test("the workspace only offers a preview where one is safe", async () => {
  const source = await read("../app/dashboard/client-documents-workspace.tsx");
  assert.match(source, /canViewInline\(document\.mimeType\)/);
  assert.match(source, /client-document-noview/, "types without a safe preview say so");
  assert.match(source, /rel="noopener noreferrer"/);
  assert.match(source, /\/documents\/\$\{document\.id\}\/download/);
});

test("every client is listed, so an empty library still has somewhere to start", async () => {
  const library = await read("../lib/documents/library.ts");
  // Seeded from the active client list, not only from clients that have files.
  assert.match(library, /clients\.map\(\(client\) => \[client\.id, \{ documents: \[\]/);
  // An archived client keeps its documents even though it is not in that list.
  assert.match(library, /groups\.get\(row\.legalEntityId\) \?\? \{ documents: \[\]/);

  const workspace = await read("../app/dashboard/client-documents-workspace.tsx");
  // Picking a client opens the upload dialog already filed against them.
  assert.match(workspace, /onClick=\{\(\) => setUploadFor\(group\.legalEntityId\)\}/);
  assert.match(workspace, /initialClientId=\{uploadFor \?\? undefined\}/);
  // Remounted per client, so the form never opens holding the previous one.
  assert.match(workspace, /key=\{uploadFor \?\? "none"\}/);
  // Someone who cannot upload gets an inert row rather than a dialog that refuses.
  assert.match(workspace, /disabled=\{!canWrite\}/);

  // Expanding is a separate control from uploading, and says what it controls.
  assert.match(workspace, /aria-expanded=\{open\}/);
  assert.match(workspace, /aria-controls=\{`documents-\$\{group\.legalEntityId\}`\}/);
});

test("the submenu is permission-gated by the same rule as the rest of the nav", async () => {
  const [navigation, shell] = await Promise.all([
    read("../lib/dashboard/navigation.ts"),
    read("../app/dashboard/dashboard-shell.tsx"),
  ]);
  assert.match(navigation, /"Client Documents": "documents:read"/);
  assert.match(shell, /label: "Client Management"/);
  assert.match(shell, /\{ icon: "documents", label: "Client Documents" \}/);
  // The parent only toggles, so its label must not collide with a routing label.
  assert.doesNotMatch(shell, /active === "Client Management"/);
});
