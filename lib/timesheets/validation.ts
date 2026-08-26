export type TimeEntryInput = {
  entryDate: string;
  minutes: number;
  legalEntityId: string | null;
  workItemId: string | null;
  officeTaskId: string | null;
  billable: boolean;
  narration: string;
};

export type TimeEntryFieldErrors = Partial<Record<"entryDate" | "duration" | "legalEntityId" | "workItemId" | "officeTaskId" | "narration", string>>;
export type TimeEntryActionState = { error: string; fieldErrors: TimeEntryFieldErrors };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DURATION_PATTERN = /^(\d{1,2}):([0-5][0-9])$/;

function text(fields: Record<string, string | undefined>, key: string) {
  return fields[key]?.trim() ?? "";
}

/** Accepts `H:MM` (1:30) or a plain minute count (90). Returns null when unparseable. */
export function parseDurationToMinutes(raw: string) {
  const value = raw.trim();
  if (!value) return null;
  const clock = DURATION_PATTERN.exec(value);
  if (clock) {
    const minutes = Number(clock[1]) * 60 + Number(clock[2]);
    return minutes >= 1 && minutes <= 1440 ? minutes : null;
  }
  if (!/^\d{1,4}$/.test(value)) return null;
  const minutes = Number(value);
  return minutes >= 1 && minutes <= 1440 ? minutes : null;
}

export function formatMinutes(minutes: number) {
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function validateTimeEntryFields(fields: Record<string, string | undefined>):
  | { success: true; data: TimeEntryInput }
  | { success: false; fieldErrors: TimeEntryFieldErrors } {
  const entryDate = text(fields, "entryDate");
  const legalEntityId = text(fields, "legalEntityId");
  const workItemId = text(fields, "workItemId");
  const officeTaskId = text(fields, "officeTaskId");
  const narration = text(fields, "narration");
  const billable = text(fields, "billable") === "on" || text(fields, "billable") === "true";
  const minutes = parseDurationToMinutes(text(fields, "duration"));
  const fieldErrors: TimeEntryFieldErrors = {};

  if (!/^\d{4}-\d{2}-\d{2}$/.test(entryDate) || Number.isNaN(Date.parse(`${entryDate}T00:00:00Z`))) fieldErrors.entryDate = "Enter the date the work was done.";
  if (minutes === null) fieldErrors.duration = "Enter the time as H:MM (1:30) or in minutes (90), up to 24 hours.";
  if (legalEntityId && !UUID_PATTERN.test(legalEntityId)) fieldErrors.legalEntityId = "Select a valid client.";
  if (workItemId && !UUID_PATTERN.test(workItemId)) fieldErrors.workItemId = "Select a valid work item.";
  if (officeTaskId && !UUID_PATTERN.test(officeTaskId)) fieldErrors.officeTaskId = "Select a valid task.";
  if (narration.length < 2 || narration.length > 500) fieldErrors.narration = "Describe the work in 2 to 500 characters.";
  if (billable && !legalEntityId) fieldErrors.legalEntityId = "Billable time must be recorded against a client.";

  if (Object.keys(fieldErrors).length) return { success: false, fieldErrors };
  return {
    success: true,
    data: {
      entryDate,
      minutes: minutes!,
      legalEntityId: legalEntityId || null,
      workItemId: workItemId || null,
      officeTaskId: officeTaskId || null,
      billable,
      narration,
    },
  };
}
