import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPackageFee,
  validateAssignmentFields,
  validatePackageFields,
  validateServiceFields,
} from "../lib/packages/validation";

const SERVICE_A = "25000000-0000-4000-8000-000000000001";
const SERVICE_B = "25000000-0000-4000-8000-000000000002";
const PACKAGE_ID = "26000000-0000-4000-8000-000000000001";
const CLIENT_ID = "30000000-0000-4000-8000-000000000001";

test("service catalogue validation normalizes safe tenant-owned definitions", () => {
  const result = validateServiceFields({
    category: "  Indirect tax ",
    code: " gst_monthly ",
    description: "  GST return preparation and filing. ",
    name: "  GST Monthly Compliance ",
    status: "active",
  });
  assert.equal(result.success, true);
  if (result.success) assert.deepEqual(result.data, {
    category: "Indirect tax",
    code: "GST_MONTHLY",
    description: "GST return preparation and filing.",
    name: "GST Monthly Compliance",
    standardMinutes: null,
    status: "active",
  });

  assert.equal(validateServiceFields({ code: "10B", name: "Form 10B audit", category: "Assurance", description: "", status: "active" }).success, true);

  assert.equal(validateServiceFields({ code: "x", name: "", category: "", description: "", status: "deleted" }).success, false);
});

test("package validation stores exact paise and unique included services", () => {
  const result = validatePackageFields({
    billingCycle: "quarterly",
    code: " growth_plus ",
    description: "  Quarterly compliance bundle. ",
    name: " Growth Plus ",
    serviceIds: [SERVICE_B, SERVICE_A, SERVICE_A],
    standardFee: "12,500.50",
    status: "active",
  });
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.standardFeePaise, 1_250_050);
    assert.deepEqual(result.data.serviceIds, [SERVICE_A, SERVICE_B]);
  }
  assert.equal(formatPackageFee(1_250_050), "₹12,500.50");

  for (const standardFee of ["-1", "1e3", "1.999"]) {
    assert.equal(validatePackageFields({ billingCycle: "monthly", code: "STARTER", name: "Starter", serviceIds: [SERVICE_A], standardFee, status: "active" }).success, false);
  }
  assert.equal(validatePackageFields({ billingCycle: "monthly", code: "10B", name: "Starter", serviceIds: [SERVICE_A], standardFee: "0", status: "active" }).success, false);
  assert.equal(validatePackageFields({ billingCycle: "monthly", code: "STARTER", name: "Starter", serviceIds: [SERVICE_A, "not-a-service"], standardFee: "0", status: "active" }).success, false);
  assert.equal(validatePackageFields({ billingCycle: "weekly", code: "STARTER", name: "Starter", serviceIds: [], standardFee: "0", status: "active" }).success, false);
});

test("client assignment validation enforces dates, add-ons, and replacement confirmation", () => {
  const valid = validateAssignmentFields({
    addonServiceIds: [SERVICE_B, SERVICE_B],
    agreedFee: "15,000",
    effectiveFrom: "2026-08-16",
    effectiveTo: "2027-08-15",
    legalEntityId: CLIENT_ID,
    packageId: PACKAGE_ID,
    replaceExisting: "on",
  }, [SERVICE_A]);
  assert.equal(valid.success, true);
  if (valid.success) assert.deepEqual(valid.data.addonServiceIds, [SERVICE_B]);

  const duplicate = validateAssignmentFields({
    addonServiceIds: [SERVICE_A], agreedFee: "100", effectiveFrom: "2026-08-16",
    effectiveTo: "2026-08-15", legalEntityId: CLIENT_ID, packageId: PACKAGE_ID,
  }, [SERVICE_A], true);
  assert.equal(duplicate.success, false);
  if (!duplicate.success) {
    assert.ok(duplicate.fieldErrors.addonServiceIds);
    assert.ok(duplicate.fieldErrors.effectiveTo);
    assert.ok(duplicate.fieldErrors.replaceExisting);
  }

  assert.equal(validateAssignmentFields({ agreedFee: "1", effectiveFrom: "bad", legalEntityId: "bad", packageId: "bad" }).success, false);
  assert.equal(validateAssignmentFields({ addonServiceIds: [SERVICE_B, "not-a-service"], agreedFee: "1", effectiveFrom: "2026-08-16", legalEntityId: CLIENT_ID, packageId: PACKAGE_ID }).success, false);
});

test("service standard minutes accepts a blank value as unestimated", () => {
  const result = validateServiceFields({ category: "GST", code: "GSTR3B", description: "", name: "GSTR-3B", standardMinutes: "", status: "active" });
  assert.equal(result.success, true);
  assert.equal(result.success && result.data.standardMinutes, null);
});

test("service standard minutes accepts a whole number of minutes", () => {
  const result = validateServiceFields({ category: "GST", code: "GSTR3B", description: "", name: "GSTR-3B", standardMinutes: "90", status: "active" });
  assert.equal(result.success && result.data.standardMinutes, 90);
});

test("service standard minutes rejects zero, fractions, and out-of-range values", () => {
  for (const value of ["0", "1.5", "-5", "100001"]) {
    const result = validateServiceFields({ category: "GST", code: "GSTR3B", description: "", name: "GSTR-3B", standardMinutes: value, status: "active" });
    assert.equal(result.success, false, `expected ${value} to be rejected`);
  }
});
