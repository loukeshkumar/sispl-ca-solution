import assert from "node:assert/strict";
import test from "node:test";

import { loadOptionalPanel } from "../lib/dashboard/optional-panel";

function captureConsoleError() {
  const original = console.error;
  const calls: unknown[][] = [];
  console.error = (...args: unknown[]) => { calls.push(args); };
  return { calls, restore: () => { console.error = original; } };
}

test("a healthy panel returns its own data untouched", async () => {
  const value = await loadOptionalPanel("checklist", async () => [{ id: "1" }], []);
  assert.deepEqual(value, [{ id: "1" }]);
});

test("a failing panel degrades to the fallback instead of taking down the page", async () => {
  const captured = captureConsoleError();
  try {
    const value = await loadOptionalPanel("checklist", async () => { throw new Error("relation does not exist"); }, []);
    assert.deepEqual(value, [], "the page must still render with an empty panel");
  } finally {
    captured.restore();
  }
});

test("the failure is logged with the panel name and error type but never the message", async () => {
  const captured = captureConsoleError();
  try {
    await loadOptionalPanel("document-checklist", async () => {
      const error = new Error('select "code" from "document_checklist_items" where tenant_id = $1');
      error.name = "DrizzleQueryError";
      throw error;
    }, []);
  } finally {
    captured.restore();
  }
  assert.equal(captured.calls.length, 1);
  const [message, context] = captured.calls[0] as [string, Record<string, string>];
  assert.match(message, /Optional panel failed/);
  assert.equal(context.panel, "document-checklist");
  assert.equal(context.errorType, "DrizzleQueryError");
  const serialised = JSON.stringify(captured.calls[0]);
  assert.ok(!serialised.includes("document_checklist_items"), "a query must never reach the log");
  assert.ok(!serialised.includes("$1"));
});

test("a non-Error rejection is still contained and typed", async () => {
  const captured = captureConsoleError();
  try {
    const value = await loadOptionalPanel("panel", async () => { throw "string failure"; }, null);
    assert.equal(value, null);
  } finally {
    captured.restore();
  }
  const [, context] = captured.calls[0] as [string, Record<string, string>];
  assert.equal(context.errorType, "UnknownError");
});
