import assert from "node:assert/strict";
import test from "node:test";

test("personal to-do validation normalizes a complete private item", async () => {
  const validation = await import("../lib/todos/validation").catch(() => ({})) as Record<string, unknown>;
  assert.equal(typeof validation.validateTodoFields, "function");
  const result = (validation.validateTodoFields as (fields: Record<string, string>) => { success: boolean; data?: unknown })({
    title: "  Call client about signed return  ",
    notes: "  Confirm the director's availability.  ",
    dueDate: "2026-08-17",
    dueTime: "14:30",
    priority: "high",
    category: "  Client follow-up  ",
  });
  assert.deepEqual(result, {
    success: true,
    data: {
      title: "Call client about signed return",
      notes: "Confirm the director's availability.",
      dueDate: "2026-08-17",
      dueTime: "14:30",
      priority: "high",
      category: "Client follow-up",
    },
  });
});

test("personal to-do validation rejects unsafe lengths and inconsistent due values", async () => {
  const validation = await import("../lib/todos/validation").catch(() => ({})) as Record<string, unknown>;
  assert.equal(typeof validation.validateTodoFields, "function");
  const validate = validation.validateTodoFields as (fields: Record<string, string>) => { success: boolean; fieldErrors?: Record<string, string> };
  const invalid = validate({ title: "", notes: "x".repeat(2001), dueDate: "2026-02-30", dueTime: "25:90", priority: "highest", category: "x".repeat(41) });
  assert.equal(invalid.success, false);
  assert.deepEqual(Object.keys(invalid.fieldErrors ?? {}).sort(), ["category", "dueDate", "dueTime", "notes", "priority", "title"]);
  const timeWithoutDate = validate({ title: "File response", notes: "", dueDate: "", dueTime: "09:00", priority: "normal", category: "" });
  assert.equal(timeWithoutDate.success, false);
  assert.match(timeWithoutDate.fieldErrors?.dueTime ?? "", /due date/i);
});
