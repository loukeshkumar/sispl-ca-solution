"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "../../lib/auth/server";
import { getDatabase } from "../../lib/dashboard/postgres/pool";
import { createTimeEntry, deleteOwnTimeEntry, TimesheetRepositoryError } from "../../lib/timesheets/repository";
import { validateTimeEntryFields, type TimeEntryActionState } from "../../lib/timesheets/validation";
import { TimesheetGovernanceError } from "../../lib/timesheets/period-repository";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESHEETS_URL = "/?workspace=timesheets";

export async function createTimeEntryAction(_previous: TimeEntryActionState, formData: FormData): Promise<TimeEntryActionState> {
  const session = await requirePermission("timesheets:use", TIMESHEETS_URL);
  const validation = validateTimeEntryFields(Object.fromEntries(
    [...formData.entries()].filter(([, value]) => typeof value === "string").map(([key, value]) => [key, String(value)]),
  ));
  if (!validation.success) return { error: "Review the highlighted fields.", fieldErrors: validation.fieldErrors };
  try {
    // The employee whose time it is, and who is typing, are the same person on
    // this path. Recording somebody else's late time is a manager's action and
    // lives in its own form.
    await createTimeEntry(getDatabase(), session.tenantId, session.userId, validation.data);
  } catch (error) {
    return {
      error: error instanceof TimesheetGovernanceError || error instanceof TimesheetRepositoryError
        ? error.message
        : "The time entry could not be saved.",
      fieldErrors: {},
    };
  }
  revalidatePath("/");
  redirect(TIMESHEETS_URL);
}

export async function deleteTimeEntryAction(formData: FormData) {
  const session = await requirePermission("timesheets:use", TIMESHEETS_URL);
  const entryId = String(formData.get("entryId") ?? "");
  if (UUID_PATTERN.test(entryId)) {
    try {
      await deleteOwnTimeEntry(getDatabase(), session.tenantId, session.userId, entryId);
    } catch {
      redirect(`${TIMESHEETS_URL}&timesheetError=state`);
    }
  }
  revalidatePath("/");
  redirect(TIMESHEETS_URL);
}
