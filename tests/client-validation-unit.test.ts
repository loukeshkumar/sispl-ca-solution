import assert from "node:assert/strict";
import test from "node:test";

import { validateClientFields } from "../lib/clients/validation";

const validFields = {
  city: "Patna, Bihar",
  displayName: "Example Industries",
  entityType: "Private Company",
  gstRegistrations: "2",
  healthScore: "76",
  legalName: "Example Industries Private Limited",
  maskedPan: "AABCA••••F",
  ownerId: "20000000-0000-4000-8000-000000000001",
  relationshipStart: "2026-08-16",
  riskStatus: "watch",
  services: ["GST", "Books"],
};

test("client validation produces a normalized write model", () => {
  const result = validateClientFields(validFields);
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.maskedPan, "AABCA••••F");
  assert.equal(result.data.healthScore, 76);
  assert.equal(result.data.gstRegistrations, 2);
  assert.deepEqual(result.data.services, ["GST", "BOOKS"]);
});

test("client validation accepts new service-master codes without a hard-coded allowlist", () => {
  const result = validateClientFields({ ...validFields, services: ["virtual_cfo", "GST"] });
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.deepEqual(result.data.services, ["VIRTUAL_CFO", "GST"]);
});

test("client validation rejects complete PAN data", () => {
  const result = validateClientFields({ ...validFields, maskedPan: "ABCDE1234F" });
  assert.equal(result.success, false);
  if (result.success) return;
  assert.match(result.fieldErrors.maskedPan ?? "", /Do not enter a complete PAN/);
});

test("client validation rejects unsafe scores, dates, owners, and empty services", () => {
  const result = validateClientFields({
    ...validFields,
    gstRegistrations: "51",
    healthScore: "101",
    ownerId: "another-tenant-user",
    relationshipStart: "2026-02-30",
    services: [],
  });
  assert.equal(result.success, false);
  if (result.success) return;
  assert.ok(result.fieldErrors.gstRegistrations);
  assert.ok(result.fieldErrors.healthScore);
  assert.ok(result.fieldErrors.ownerId);
  assert.ok(result.fieldErrors.relationshipStart);
  assert.ok(result.fieldErrors.services);
});
