import assert from "node:assert/strict";
import test from "node:test";

import { validatePortalContactFields, validatePortalPassword } from "../lib/portal/validation";
import { PORTAL_SESSION_COOKIE_NAME, PORTAL_SESSION_DURATION_MS } from "../lib/portal/server";
import { SESSION_COOKIE_NAME, SESSION_DURATION_MS } from "../lib/auth/server";

const ENTITY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

test("portal sessions use a separate cookie and a shorter lifetime than staff sessions", () => {
  assert.notEqual(PORTAL_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME);
  assert.equal(PORTAL_SESSION_COOKIE_NAME, "sispl_portal_session");
  assert.ok(PORTAL_SESSION_DURATION_MS < SESSION_DURATION_MS, "portal sessions must not outlive staff sessions");
});

test("portal contact validation normalises the contact and rejects malformed input", () => {
  const result = validatePortalContactFields({ legalEntityId: ENTITY, email: "  Owner@Example.Invalid ", fullName: "  Asha   Menon " });
  assert.ok(result.success);
  assert.equal(result.data.email, "owner@example.invalid");
  assert.equal(result.data.fullName, "Asha Menon");

  const badEntity = validatePortalContactFields({ legalEntityId: "nope", email: "owner@example.invalid", fullName: "Asha Menon" });
  assert.ok(!badEntity.success);
  assert.ok(badEntity.fieldErrors.legalEntityId);

  const badEmail = validatePortalContactFields({ legalEntityId: ENTITY, email: "owner-at-example", fullName: "Asha Menon" });
  assert.ok(!badEmail.success);
  assert.ok(badEmail.fieldErrors.email);

  const shortName = validatePortalContactFields({ legalEntityId: ENTITY, email: "owner@example.invalid", fullName: "A" });
  assert.ok(!shortName.success);
  assert.ok(shortName.fieldErrors.fullName);
});

test("portal password rules require length, a mix of characters, and a matching confirmation", () => {
  assert.deepEqual(validatePortalPassword("Str0ng-portal-pass", "Str0ng-portal-pass"), {});
  assert.ok(validatePortalPassword("short1", "short1").password);
  assert.ok(validatePortalPassword("alllettersonly", "alllettersonly").password);
  assert.ok(validatePortalPassword("Str0ng-portal-pass", "Str0ng-portal-pas").confirmPassword);
});
