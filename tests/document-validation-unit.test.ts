import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { commitStagedDocument, readDocumentFile, removeDocumentFile, stageDocumentFile, storeDocumentFile } from "../lib/documents/storage";
import { safeOriginalFileName, validateDocumentBytes, validateDocumentFile, validateDocumentRequestFields } from "../lib/documents/validation";

test("document request validation normalizes safe input and rejects invalid relationships", () => {
  const valid = validateDocumentRequestFields({
    description: "  Signed by both directors  ", dueDate: "2026-08-31",
    legalEntityId: "40000000-0000-4000-8000-000000000001", title: "  Signed statements  ", workItemId: "",
  });
  assert.equal(valid.success, true);
  if (valid.success) assert.deepEqual(valid.data, {
    description: "Signed by both directors", dueDate: "2026-08-31",
    legalEntityId: "40000000-0000-4000-8000-000000000001", title: "Signed statements", workItemId: null,
  });
  const invalid = validateDocumentRequestFields({ description: "", dueDate: "2026-02-30", legalEntityId: "other-tenant", title: "x", workItemId: "bad" });
  assert.equal(invalid.success, false);
  if (!invalid.success) assert.deepEqual(Object.keys(invalid.fieldErrors).sort(), ["dueDate", "legalEntityId", "title", "workItemId"]);
});

test("document file validation enforces allowlisted formats and the 10 MB boundary", () => {
  assert.equal(validateDocumentFile(new File(["pdf"], "report.pdf", { type: "application/pdf" })), null);
  assert.match(validateDocumentFile(new File(["script"], "payload.html", { type: "text/html" })) ?? "", /PDF/);
  assert.match(validateDocumentFile(new File(["script"], "payload.exe", { type: "application/pdf" })) ?? "", /extension/);
  assert.equal(validateDocumentBytes(new File([], "report.pdf", { type: "application/pdf" }), new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])), null);
  assert.match(validateDocumentBytes(new File([], "report.pdf", { type: "application/pdf" }), new TextEncoder().encode("not a pdf")) ?? "", /signature/);
  assert.equal(safeOriginalFileName("../../folder\\report.pdf\u0000"), "report.pdf");
  assert.equal(safeOriginalFileName("safe\u202Efdp.exe"), "safefdp.exe");
});

test("document upload relations cannot retain another client's work or request", async () => {
  const validation = await import("../lib/documents/validation") as Record<string, unknown>;
  const reconcile = validation.reconcileDocumentUploadRelations;
  assert.equal(typeof reconcile, "function");
  const selection = (reconcile as (input: unknown) => unknown)({
    legalEntityId: "client-a",
    workItemId: "work-b",
    requestId: "request-b",
    work: [
      { id: "work-a", legalEntityId: "client-a" },
      { id: "work-b", legalEntityId: "client-b" },
    ],
    requests: [
      { id: "request-a", legalEntityId: "client-a" },
      { id: "request-b", legalEntityId: "client-b" },
    ],
  });
  assert.deepEqual(selection, {
    work: [{ id: "work-a", legalEntityId: "client-a" }],
    requests: [{ id: "request-a", legalEntityId: "client-a" }],
    workItemId: "",
    requestId: "",
  });
});

test("document upload relationship failures become field-specific action errors", async () => {
  const validation = await import("../lib/documents/validation") as Record<string, unknown>;
  const mapError = validation.documentUploadRepositoryErrorState;
  assert.equal(typeof mapError, "function");
  assert.deepEqual((mapError as (code: string) => unknown)("work_not_found"), {
    error: "Review the highlighted fields.",
    fieldErrors: { workItemId: "Choose work that belongs to the selected client." },
  });
  assert.deepEqual((mapError as (code: string) => unknown)("request_closed"), {
    error: "Review the highlighted fields.",
    fieldErrors: { requestId: "This request is no longer open. Choose another request." },
  });
  assert.equal((mapError as (code: string) => unknown)("document_not_found"), null);
});

test("document upload form uses controlled client-scoped relationship options", async () => {
  const source = await readFile(new URL("../app/documents/upload-form.tsx", import.meta.url), "utf8");
  assert.match(source, /reconcileDocumentUploadRelations/);
  assert.match(source, /value=\{selectedClientId\}/);
  assert.match(source, /value=\{selectedWorkItemId\}/);
  assert.match(source, /value=\{selectedRequestId\}/);
  assert.doesNotMatch(source, /defaultValue=/);
});

test("staged storage is promoted atomically before authenticated reads", async () => {
  const tenantId = "10000000-0000-4000-8000-000000000001";
  const bytes = new TextEncoder().encode("staged document");
  const staged = await stageDocumentFile(tenantId, bytes);
  await assert.rejects(() => readDocumentFile(tenantId, staged.storageName), /ENOENT/);
  await commitStagedDocument(tenantId, staged.storageName);
  try {
    assert.deepEqual(await readDocumentFile(tenantId, staged.storageName), Buffer.from(bytes));
  } finally {
    await removeDocumentFile(tenantId, staged.storageName);
  }
});

test("document storage uses opaque names and returns the stored bytes", async () => {
  const tenantId = "10000000-0000-4000-8000-000000000001";
  const bytes = new TextEncoder().encode("document payload");
  const stored = await storeDocumentFile(tenantId, bytes);
  try {
    assert.match(stored.storageName, /^[0-9a-f-]{36}$/);
    assert.equal(stored.sha256.length, 64);
    assert.deepEqual(await readDocumentFile(tenantId, stored.storageName), Buffer.from(bytes));
    await assert.rejects(() => readDocumentFile(tenantId, "../../secret"), /Invalid document storage reference/);
  } finally {
    await removeDocumentFile(tenantId, stored.storageName);
  }
});
