import assert from "node:assert/strict";
import test from "node:test";

import { validateOfficeTaskFields, validateTaskSelfUpdateFields } from "../lib/tasks/validation";

const ASSIGNEE_ID = "20000000-0000-4000-8000-000000000002";
const REVIEWER_ID = "20000000-0000-4000-8000-000000000003";
const CLIENT_ID = "40000000-0000-4000-8000-000000000001";

const validFields = {
  assigneeId: ASSIGNEE_ID,
  blockerNote: "",
  description: "Prepare the supporting reconciliation and submit it for review.",
  dueDate: "2026-08-24",
  legalEntityId: CLIENT_ID,
  priority: "high",
  reviewerId: REVIEWER_ID,
  status: "todo",
  title: "Prepare GST reconciliation",
  workItemId: "",
};

test("office-task validation produces normalized assignment data", () => {
  const result = validateOfficeTaskFields(validFields);
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.title, "Prepare GST reconciliation");
  assert.equal(result.data.assigneeId, ASSIGNEE_ID);
  assert.equal(result.data.legalEntityId, CLIENT_ID);
  assert.equal(result.data.workItemId, null);
});

test("office-task validation enforces reviewer separation and waiting context", () => {
  const result = validateOfficeTaskFields({
    ...validFields,
    blockerNote: "",
    reviewerId: ASSIGNEE_ID,
    status: "waiting",
  });
  assert.equal(result.success, false);
  if (result.success) return;
  assert.ok(result.fieldErrors.reviewerId);
  assert.ok(result.fieldErrors.blockerNote);
});

test("employee self-updates allow only non-terminal workflow states", () => {
  const valid = validateTaskSelfUpdateFields({ blockerNote: "Client confirmation awaited", status: "waiting" });
  assert.equal(valid.success, true);
  const invalid = validateTaskSelfUpdateFields({ blockerNote: "", status: "completed" });
  assert.equal(invalid.success, false);
});
