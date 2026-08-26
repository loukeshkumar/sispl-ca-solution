"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "../../lib/auth/server";
import { getDatabase } from "../../lib/dashboard/postgres/pool";
import { createTimeEntry, TimesheetRepositoryError } from "../../lib/timesheets/repository";
import {
  decidePeriod,
  reopenPeriod,
  submitPeriod,
  TimesheetGovernanceError,
} from "../../lib/timesheets/period-repository";
import { validateTimeEntryFields } from "../../lib/timesheets/validation";

export type PeriodActionState = { error: string; notice: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const refresh = () => {
  revalidatePath("/timesheets/periods");
  revalidatePath("/");
};

const failure = (error: unknown, fallback: string): PeriodActionState => ({
  error: error instanceof TimesheetGovernanceError || error instanceof TimesheetRepositoryError ? error.message : fallback,
  notice: "",
});

export async function submitPeriodAction(_previous: PeriodActionState, formData: FormData): Promise<PeriodActionState> {
  const session = await requirePermission("timesheets:use", "/timesheets/periods");
  const periodKey = String(formData.get("periodKey") ?? "");
  if (!PERIOD_PATTERN.test(periodKey)) return { error: "Choose a month.", notice: "" };
  try {
    const minutes = await submitPeriod(getDatabase(), session.tenantId, session.userId, periodKey);
    refresh();
    return { error: "", notice: `${periodKey} sent for approval — ${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m. Nothing in it can change until it is decided.` };
  } catch (error) {
    return failure(error, "That month could not be submitted.");
  }
}

/** Deciding is a manager's act; the repository refuses self-approval regardless. */
export async function decidePeriodAction(_previous: PeriodActionState, formData: FormData): Promise<PeriodActionState> {
  const session = await requirePermission("timesheets:manage", "/timesheets/periods");
  const employeeUserId = String(formData.get("employeeUserId") ?? "");
  const periodKey = String(formData.get("periodKey") ?? "");
  const outcome = String(formData.get("outcome") ?? "");
  if (!UUID_PATTERN.test(employeeUserId) || !PERIOD_PATTERN.test(periodKey)) {
    return { error: "That timesheet could not be found.", notice: "" };
  }
  try {
    await decidePeriod(getDatabase(), session.tenantId, session.userId, employeeUserId, periodKey, outcome, String(formData.get("note") ?? ""));
    refresh();
    return {
      error: "",
      notice: outcome === "approved"
        ? `${periodKey} approved. The entries are frozen.`
        : `${periodKey} returned. It is open again for correction.`,
    };
  } catch (error) {
    return failure(error, "That decision could not be recorded.");
  }
}

export async function reopenPeriodAction(_previous: PeriodActionState, formData: FormData): Promise<PeriodActionState> {
  const session = await requirePermission("timesheets:manage", "/timesheets/periods");
  const employeeUserId = String(formData.get("employeeUserId") ?? "");
  const periodKey = String(formData.get("periodKey") ?? "");
  if (!UUID_PATTERN.test(employeeUserId) || !PERIOD_PATTERN.test(periodKey)) {
    return { error: "That timesheet could not be found.", notice: "" };
  }
  try {
    await reopenPeriod(getDatabase(), session.tenantId, session.userId, employeeUserId, periodKey, String(formData.get("reason") ?? ""));
    refresh();
    return { error: "", notice: `${periodKey} reopened. The reason is on the record.` };
  } catch (error) {
    return failure(error, "That month could not be reopened.");
  }
}

/**
 * A manager recording time outside the back-dating window, on somebody's behalf.
 *
 * The one path by which an entry older than the firm's window can exist at all.
 */
export async function recordLateEntryAction(_previous: PeriodActionState, formData: FormData): Promise<PeriodActionState> {
  const session = await requirePermission("timesheets:manage", "/timesheets/periods");
  const employeeUserId = String(formData.get("employeeUserId") ?? "");
  if (!UUID_PATTERN.test(employeeUserId)) return { error: "Choose whose time this is.", notice: "" };

  const validation = validateTimeEntryFields(Object.fromEntries(
    [...formData.entries()].filter(([, value]) => typeof value === "string").map(([key, value]) => [key, String(value)]),
  ));
  if (!validation.success) return { error: "Review the entry — a date, a duration and a narration are all needed.", notice: "" };

  try {
    await createTimeEntry(getDatabase(), session.tenantId, employeeUserId, validation.data, {
      actorUserId: session.userId,
      backdateReason: String(formData.get("backdateReason") ?? ""),
    });
    refresh();
    return { error: "", notice: "Recorded, with your name and reason against it." };
  } catch (error) {
    return failure(error, "That entry could not be recorded.");
  }
}
