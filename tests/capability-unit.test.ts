import assert from "node:assert/strict";
import test from "node:test";

import {
  assessAssignee,
  assessReviewer,
  benchRisk,
  CAPABILITY_LEVELS,
  isCapabilityLevel,
  isQualification,
  holdsMembership,
  meets,
  rankMembers,
  serviceIsGoverned,
  type CapabilityRecord,
} from "../lib/team/capability";
import { validateEmployeeFields } from "../lib/team/validation";

const records = (...entries: Array<[string, string]>): CapabilityRecord[] =>
  entries.map(([serviceCode, level]) => ({ level: level as CapabilityRecord["level"], serviceCode }));

test("capability is a ladder, so a higher rating carries the lower ones", () => {
  assert.equal(meets("review", "prepare"), true, "a reviewer can obviously prepare");
  assert.equal(meets("sign", "review"), true);
  assert.equal(meets("prepare", "review"), false, "preparing is not reviewing");
  assert.equal(meets("learning", "prepare"), false);
  assert.equal(meets(null, "prepare"), false, "no rating is not a rating");
});

test("every level is ordered, with none accidentally equal", () => {
  for (let index = 1; index < CAPABILITY_LEVELS.length; index += 1) {
    const lower = CAPABILITY_LEVELS[index - 1]!;
    const higher = CAPABILITY_LEVELS[index]!;
    assert.equal(meets(higher, lower), true, `${higher} must reach ${lower}`);
    assert.equal(meets(lower, higher), false, `${lower} must not reach ${higher}`);
  }
});

test("a rated assignee passes without comment", () => {
  const verdict = assessAssignee(records(["AUDIT", "prepare"]), "AUDIT", "Audit and assurance");
  assert.equal(verdict.stretch, false);
  assert.equal(verdict.blocked, false);
});

test("giving somebody work they are not rated for is allowed, and said out loud", () => {
  // Stretch work is how people learn. Refusing it would make the firm worse,
  // and hiding it would make the record useless when the job goes wrong.
  const learning = assessAssignee(records(["AUDIT", "learning"]), "AUDIT", "Audit and assurance");
  assert.equal(learning.blocked, false);
  assert.equal(learning.stretch, true);
  assert.match(learning.message, /stretch work/);

  const unrated = assessAssignee([], "AUDIT", "Audit and assurance");
  assert.equal(unrated.blocked, false);
  assert.equal(unrated.stretch, true);
  assert.match(unrated.message, /No recorded capability/);
});

test("a reviewer without review capability is refused once the service is governed", () => {
  const verdict = assessReviewer(records(["AUDIT", "prepare"]), "AUDIT", "Audit and assurance", true);
  assert.equal(verdict.blocked, true);
  assert.match(verdict.message, /Cannot review/);
});

test("an ungoverned service refuses nobody, so the day this ships is not the day work stops", () => {
  // Enforcing an empty matrix would lock every reviewer field at once and make
  // the firm fill in a grid before it could file anything.
  const verdict = assessReviewer([], "AUDIT", "Audit and assurance", false);
  assert.equal(verdict.blocked, false);
  assert.match(verdict.message, /not being checked/);
  assert.equal(serviceIsGoverned(0), false);
  assert.equal(serviceIsGoverned(1), true);
});

test("a reviewer who can sign can also review", () => {
  const verdict = assessReviewer(records(["AUDIT", "sign"]), "AUDIT", "Audit and assurance", true);
  assert.equal(verdict.blocked, false);
});

test("capability for one service says nothing about another", () => {
  const held = records(["GST", "review"]);
  assert.equal(assessReviewer(held, "AUDIT", "Audit and assurance", true).blocked, true);
  assert.equal(assessReviewer(held, "GST", "GST compliance", true).blocked, false);
});

test("service codes match whatever their casing", () => {
  const verdict = assessReviewer(records(["audit", "review"]), "AUDIT", "Audit and assurance", true);
  assert.equal(verdict.blocked, false);
});

test("bench risk names the exposure rather than scoring it", () => {
  assert.equal(benchRisk({ reviewers: 0 }), "uncovered");
  assert.equal(benchRisk({ reviewers: 1 }), "single_point");
  assert.equal(benchRisk({ reviewers: 2 }), "thin");
  assert.equal(benchRisk({ reviewers: 3 }), "none");
});

test("a picker sorts the capable to the top without hiding anyone", () => {
  const members = [
    { fullName: "Zara", id: "z" },
    { fullName: "Amit", id: "a" },
    { fullName: "Nisha", id: "n" },
    { fullName: "Rahul", id: "r" },
  ];
  const ranked = rankMembers(members, new Map([["n", "review"], ["r", "prepare"], ["z", "learning"]] as const));
  assert.deepEqual(ranked.map((member) => member.id), ["n", "r", "z", "a"]);
  // Everyone is still offered — a manager can make the call the software did not
  // anticipate, and the rating is shown next to the name either way.
  assert.equal(ranked.length, members.length);
  assert.equal(ranked[3]!.level, null);
});

test("only the four levels and seven qualifications are accepted", () => {
  assert.ok(isCapabilityLevel("sign"));
  assert.ok(!isCapabilityLevel("expert"));
  assert.ok(isQualification("ca"));
  assert.ok(!isQualification("phd"));
});

test("a membership number belongs to a Chartered Accountant and nobody else", () => {
  assert.equal(holdsMembership("ca"), true);
  assert.equal(holdsMembership("ca_inter"), false);

  const base = {
    designation: "Audit Manager", email: "a@example.invalid", fullName: "A Person",
    joiningDate: "2026-01-01", mobileNumber: "", notes: "",
    roleDefinitionId: "11111111-1111-4111-8111-111111111111",
  };

  const wrongQualification = validateEmployeeFields({ ...base, qualification: "ca_inter", membershipNumber: "123456" });
  assert.equal(wrongQualification.success, false);
  assert.ok(wrongQualification.success === false && wrongQualification.fieldErrors.membershipNumber);

  const badShape = validateEmployeeFields({ ...base, qualification: "ca", membershipNumber: "12" });
  assert.equal(badShape.success, false);
  assert.ok(badShape.success === false && badShape.fieldErrors.membershipNumber);

  const good = validateEmployeeFields({ ...base, qualification: "ca", membershipNumber: "123456", qualifiedOn: "2020-06-01" });
  assert.equal(good.success, true);
  assert.ok(good.success === true && good.data.qualification === "ca");
  assert.ok(good.success === true && good.data.qualifiedOn === "2020-06-01");
});

test("an articled assistant has not qualified, so a qualification date is refused", () => {
  const base = {
    designation: "Articled Assistant", email: "b@example.invalid", fullName: "B Person",
    joiningDate: "2026-01-01", mobileNumber: "", notes: "",
    roleDefinitionId: "11111111-1111-4111-8111-111111111111",
  };
  const rejected = validateEmployeeFields({ ...base, qualification: "articled", qualifiedOn: "2026-02-01" });
  assert.equal(rejected.success, false);
  assert.ok(rejected.success === false && rejected.fieldErrors.qualifiedOn);

  const accepted = validateEmployeeFields({ ...base, qualification: "articled", qualifiedOn: "" });
  assert.equal(accepted.success, true);
  assert.ok(accepted.success === true && accepted.data.qualifiedOn === null);
});

test("an employee with no standing recorded still validates, defaulting to other", () => {
  const result = validateEmployeeFields({
    designation: "Office Administrator", email: "c@example.invalid", fullName: "C Person",
    joiningDate: "2026-01-01", mobileNumber: "", notes: "",
    roleDefinitionId: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(result.success, true);
  assert.ok(result.success === true && result.data.qualification === "other");
  assert.ok(result.success === true && result.data.membershipNumber === "");
});
