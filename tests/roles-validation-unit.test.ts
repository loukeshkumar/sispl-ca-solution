import assert from "node:assert/strict";
import test from "node:test";

import { validateRoleDefinitionForm } from "../lib/roles/validation";

function roleForm(values: Record<string, string | string[]>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value]) form.append(key, item);
  }
  return form;
}

test("role validation creates an explicit deny-by-default employee category", () => {
  const result = validateRoleDefinitionForm(roleForm({
    name: "GST Reviewer",
    description: "Reviews assigned GST work.",
    roleClass: "employee",
    legacyRoleKey: "manager",
    permissions: ["dashboard:read", "tasks:read", "attendance:review"],
  }));
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(result.data.permissions, ["dashboard:read", "tasks:read", "attendance:review"]);
  assert.equal(result.data.legacyRoleKey, "manager");
});

test("role validation rejects reserved permissions and missing workspace access", () => {
  const employee = validateRoleDefinitionForm(roleForm({ name: "Unsafe", roleClass: "employee", legacyRoleKey: "associate", permissions: ["roles:manage"] }));
  assert.equal(employee.success, false);
  if (!employee.success) assert.ok(employee.fieldErrors.permissions);
  const admin = validateRoleDefinitionForm(roleForm({ name: "Empty Admin", roleClass: "admin", legacyRoleKey: "partner", permissions: [] }));
  assert.equal(admin.success, false);
  if (!admin.success) assert.ok(admin.fieldErrors.permissions);
});
