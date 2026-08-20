import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  bufferState,
  financialYearLabel,
  minutesLabel,
  periodPresets,
  servicePlaceholder,
  workStatusTone,
} from "../lib/work/form-helpers";
import { workStatusOptions } from "../lib/work/validation";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the Indian financial year runs April to March, not January to December", () => {
  assert.equal(financialYearLabel("2026-08-20"), "FY 2026-27");
  assert.equal(financialYearLabel("2026-04-01"), "FY 2026-27");
  assert.equal(financialYearLabel("2026-03-31"), "FY 2025-26");
  assert.equal(financialYearLabel("2027-01-15"), "FY 2026-27");
});

test("period presets follow the statutory quarter, not the calendar quarter", () => {
  const presets = periodPresets("2026-08-20");
  assert.deepEqual(presets.map((preset) => preset.value), ["August 2026", "Q2 - FY 2026-27", "FY 2026-27"]);
  // April opens Q1, so a January date is Q4 of the previous financial year.
  assert.equal(periodPresets("2026-04-05")[1]!.value, "Q1 - FY 2026-27");
  assert.equal(periodPresets("2027-01-05")[1]!.value, "Q4 - FY 2026-27");
  assert.equal(periodPresets("2026-12-31")[1]!.value, "Q3 - FY 2026-27");
});

test("the buffer reports how much slack the firm gave itself", () => {
  assert.equal(bufferState("2026-08-27", "2026-08-25").days, 2);
  assert.equal(bufferState("2026-08-27", "2026-08-25").tone, "tight");
  assert.equal(bufferState("2026-08-27", "2026-08-20").tone, "ok");
  assert.match(bufferState("2026-08-27", "2026-08-25").label, /2 days/);
});

test("the buffer names a same-day internal date rather than calling it zero days", () => {
  const state = bufferState("2026-08-27", "2026-08-27");
  assert.equal(state.days, 0);
  assert.match(state.label, /same day/i);
  assert.equal(state.tone, "tight");
});

test("an internal date past the statutory deadline is rejected before submit", () => {
  const state = bufferState("2026-08-27", "2026-08-30");
  assert.equal(state.tone, "invalid");
  assert.match(state.label, /after the statutory deadline/i);
});

test("the buffer stays silent until both dates exist", () => {
  for (const [statutory, internal] of [["", ""], ["2026-08-27", ""], ["", "2026-08-25"]]) {
    const state = bufferState(statutory!, internal!);
    assert.equal(state.tone, "none");
    assert.equal(state.label, "");
    assert.equal(state.days, null);
  }
});

test("minutes read back as hours the way someone says them out loud", () => {
  assert.equal(minutesLabel(null), "");
  assert.equal(minutesLabel(0), "");
  assert.equal(minutesLabel(45), "45m");
  assert.equal(minutesLabel(60), "1h");
  assert.equal(minutesLabel(90), "1h 30m");
  assert.equal(minutesLabel(600), "10h");
});

test("every workflow status has a tone, so the select can never render untinted", () => {
  for (const status of workStatusOptions) {
    assert.ok(["red", "amber", "blue", "mint"].includes(workStatusTone(status)), `${status} needs a tone`);
  }
});

test("an empty service list distinguishes no client from no entitlement", () => {
  const noClient = servicePlaceholder(false, 0);
  const noServices = servicePlaceholder(true, 0);
  assert.notEqual(noClient, noServices, "the two states need different fixes and must read differently");
  assert.match(noClient, /client/i);
  assert.match(noServices, /package/i);
  assert.equal(servicePlaceholder(true, 3), "");
});

test("the dialog wires the live feedback and keeps its accent to itself", async () => {
  const [form, dialog, workDialog, clientForm, taskForm] = await Promise.all([
    read("app/work/work-form.tsx"),
    read("app/dashboard/form-dialog.tsx"),
    read("app/dashboard/work-dialog.tsx"),
    read("app/clients/client-form.tsx"),
    read("app/tasks/task-form.tsx"),
  ]);
  for (const helper of ["bufferState", "minutesLabel", "periodPresets", "servicePlaceholder", "workStatusTone"]) {
    assert.ok(form.includes(helper), `the form must use ${helper} rather than reimplementing it`);
  }
  // Accessibility survives the restyle.
  assert.match(form, /aria-describedby/);
  assert.match(form, /aria-invalid/);
  assert.match(form, /aria-live/, "live feedback must be announced, not only coloured");
  // Progress cannot reach 100 on open work, so the bar must not imply it can.
  assert.match(form, /max=\{99\}/);

  assert.match(dialog, /accent/, "the shell must accept an opt-in accent");
  assert.ok(workDialog.includes("accent="), "the work dialog opts in");
  for (const [name, source] of [["client", clientForm], ["task", taskForm]] as const) {
    assert.doesNotMatch(source, /work-editor-accent/, `${name} form must not inherit the work dialog accent`);
  }
});
