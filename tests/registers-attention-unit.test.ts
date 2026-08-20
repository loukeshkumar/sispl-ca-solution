import assert from "node:assert/strict";
import test from "node:test";

import { buildAttentionQueue, certificateBand, LIVE_DSC_STATUSES } from "../lib/registers/attention";
import { planBulkDscMovement, planBulkNoticeChange, type DscBulkCandidate, type NoticeBulkCandidate } from "../lib/registers/bulk";
import { DEFAULT_REGISTER_PARAMS, parseRegisterParams, registerHref, REGISTER_TABS } from "../lib/registers/queue-params";

const TODAY = "2026-08-21";

const notice = (over: Partial<Parameters<typeof buildAttentionQueue>[0]["notices"][number]> = {}) => ({
  assigneeName: "Rahul K.",
  clientName: "Koshi Infra LLP",
  id: "n1",
  responseDueDate: "2026-08-10",
  status: "open",
  subject: "Scrutiny under 143(2)",
  ...over,
});

const certificate = (over: Partial<Parameters<typeof buildAttentionQueue>[0]["certificates"][number]> = {}) => ({
  clientName: "Aarav Retail Pvt. Ltd.",
  holderName: "A. Sharma",
  id: "d1",
  serialNumber: "SN-1",
  status: "in_custody",
  validUntil: "2026-09-01",
  ...over,
});

test("a notice already answered is never an outstanding action", () => {
  // However overdue its original deadline, a responded or closed notice needs
  // nothing further. Leaving it in would make the queue untrustworthy.
  for (const status of ["responded", "closed"]) {
    const queue = buildAttentionQueue({ certificates: [], notices: [notice({ status })], todayKey: TODAY });
    assert.deepEqual(queue, [], `${status} must not appear`);
  }
});

test("an open notice past its response date leads the queue", () => {
  const queue = buildAttentionQueue({ certificates: [], notices: [notice()], todayKey: TODAY });
  assert.equal(queue.length, 1);
  assert.equal(queue[0]!.kind, "notice");
  assert.equal(queue[0]!.severity, "overdue");
  assert.match(queue[0]!.detail, /11 days past/);
});

test("a certificate already recorded as lapsed is not news", () => {
  for (const status of ["expired", "surrendered"]) {
    const queue = buildAttentionQueue({
      certificates: [certificate({ status, validUntil: "2026-01-01" })],
      notices: [], todayKey: TODAY,
    });
    assert.deepEqual(queue, [], `${status} must not raise an expiry warning`);
  }
});

test("a live certificate past its validity but not marked expired is flagged", () => {
  // The register has drifted from reality, which is exactly what oversight
  // should surface.
  const queue = buildAttentionQueue({
    certificates: [certificate({ status: "issued_out", validUntil: "2026-08-01" })],
    notices: [], todayKey: TODAY,
  });
  assert.equal(queue.length, 1);
  assert.equal(queue[0]!.severity, "overdue");
  assert.match(queue[0]!.detail, /expired/i);
});

test("only certificates in a live custody state can lapse", () => {
  // 'returned' is an event that sets status back to in_custody; it is never a
  // resting status, so live means in_custody or issued_out.
  assert.deepEqual([...LIVE_DSC_STATUSES], ["in_custody", "issued_out"]);
});

test("the queue ranks the most pressing risk first", () => {
  const queue = buildAttentionQueue({
    certificates: [
      certificate({ id: "d-soon", validUntil: "2026-09-10" }),
      certificate({ id: "d-lapsed", validUntil: "2026-08-01" }),
    ],
    notices: [
      notice({ id: "n-week", responseDueDate: "2026-08-26" }),
      notice({ id: "n-today", responseDueDate: TODAY }),
      notice({ id: "n-late", responseDueDate: "2026-08-01" }),
    ],
    todayKey: TODAY,
  });
  assert.deepEqual(queue.map((item) => item.id), ["n-late", "d-lapsed", "n-today", "n-week", "d-soon"]);
});

test("a certificate beyond the expiry window is not raised at all", () => {
  const queue = buildAttentionQueue({
    certificates: [certificate({ validUntil: "2027-06-01" })],
    notices: [], todayKey: TODAY, expiryWindowDays: 30,
  });
  assert.deepEqual(queue, []);
});

test("certificate bands split expired, imminent, soon and later", () => {
  assert.equal(certificateBand("2026-08-01", TODAY), "expired");
  assert.equal(certificateBand(TODAY, TODAY), "imminent");
  assert.equal(certificateBand("2026-08-28", TODAY), "imminent");
  assert.equal(certificateBand("2026-08-29", TODAY), "soon");
  assert.equal(certificateBand("2026-09-20", TODAY), "soon");
  assert.equal(certificateBand("2026-09-21", TODAY), "later");
});

test("register parameters round-trip, default to the action queue, and reject nonsense", () => {
  assert.equal(DEFAULT_REGISTER_PARAMS.tab, "attention");
  const params = parseRegisterParams({ q: "ROC", status: "in_progress", tab: "notices" });
  assert.deepEqual(parseRegisterParams(Object.fromEntries(new URL(`http://x${registerHref(params)}`).searchParams)), params);
  assert.deepEqual(parseRegisterParams({ status: "vibes", tab: "ledger" }), DEFAULT_REGISTER_PARAMS);
  assert.deepEqual(REGISTER_TABS.map((tab) => tab.key), ["attention", "notices", "dsc", "udin"]);
});

const noticeCandidate = (over: Partial<NoticeBulkCandidate> = {}): NoticeBulkCandidate => ({
  id: "n1", status: "open", ...over,
});

test("bulk notice status skips records already in that state", () => {
  const plan = planBulkNoticeChange([noticeCandidate(), noticeCandidate({ id: "n2", status: "closed" })], { kind: "status", status: "closed" });
  assert.equal(plan.apply.length, 1);
  assert.equal(plan.apply[0]!.id, "n1");
  assert.match(plan.skip[0]!.reason, /already closed/i);
});

const dscCandidate = (over: Partial<DscBulkCandidate> = {}): DscBulkCandidate => ({
  id: "d1", status: "in_custody", ...over,
});

test("bulk custody honours the transition each certificate is actually allowed", () => {
  const issue = planBulkDscMovement(
    [dscCandidate(), dscCandidate({ id: "d2", status: "issued_out" })],
    { counterpartyName: "ROC visit", eventType: "issued_out" },
  );
  assert.equal(issue.apply.length, 1);
  assert.match(issue.skip[0]!.reason, /already issued out/i);

  const back = planBulkDscMovement(
    [dscCandidate({ status: "issued_out" }), dscCandidate({ id: "d2", status: "in_custody" })],
    { counterpartyName: "", custodianUserId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", eventType: "returned" },
  );
  assert.equal(back.apply.length, 1);
  assert.match(back.skip[0]!.reason, /not signed out/i);
});

test("a lapsed or surrendered certificate accepts no custody movement at all", () => {
  for (const status of ["expired", "surrendered"]) {
    const plan = planBulkDscMovement([dscCandidate({ status })], { counterpartyName: "x", eventType: "issued_out" });
    assert.equal(plan.apply.length, 0);
    assert.match(plan.skip[0]!.reason, /expired|surrendered/i);
  }
});

test("returning a certificate requires the custodian taking it back", () => {
  const plan = planBulkDscMovement([dscCandidate({ status: "issued_out" })], { counterpartyName: "", eventType: "returned" });
  assert.equal(plan.apply.length, 0);
  assert.match(plan.skip[0]!.reason, /custodian/i);
});

test("an empty selection plans nothing rather than throwing", () => {
  assert.deepEqual(planBulkNoticeChange([], { kind: "status", status: "closed" }), { apply: [], skip: [] });
  assert.deepEqual(planBulkDscMovement([], { counterpartyName: "x", eventType: "issued_out" }), { apply: [], skip: [] });
});
