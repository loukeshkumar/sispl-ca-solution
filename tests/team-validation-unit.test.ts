import assert from "node:assert/strict";
import test from "node:test";

import { validateEmployeeFields } from "../lib/team/validation";

const validFields = {
  designation: "Audit Associate",
  email: "  Employee@Example.Invalid ",
  fullName: "  Ananya Sharma  ",
  joiningDate: "2026-08-16",
  mobileNumber: "+91 98765 43210",
  notes: "GST and audit team",
  roleDefinitionId: "26000000-0000-4000-8000-000000000003",
};

test("employee validation normalizes a safe tenant member profile", () => {
  const result = validateEmployeeFields(validFields);
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(result.data, {
    designation: "Audit Associate",
    email: "employee@example.invalid",
    fullName: "Ananya Sharma",
    joiningDate: "2026-08-16",
    mobileNumber: "+919876543210",
    notes: "GST and audit team",
    roleDefinitionId: "26000000-0000-4000-8000-000000000003",
  });
});

test("employee validation rejects invalid identity, role, mobile, and date values", () => {
  const result = validateEmployeeFields({
    ...validFields,
    designation: "",
    email: "not-an-email",
    fullName: "A",
    joiningDate: "2026-02-30",
    mobileNumber: "123",
    roleDefinitionId: "owner",
  });
  assert.equal(result.success, false);
  if (result.success) return;
  assert.ok(result.fieldErrors.fullName);
  assert.ok(result.fieldErrors.email);
  assert.ok(result.fieldErrors.roleDefinitionId);
  assert.ok(result.fieldErrors.designation);
  assert.ok(result.fieldErrors.mobileNumber);
  assert.ok(result.fieldErrors.joiningDate);
});
