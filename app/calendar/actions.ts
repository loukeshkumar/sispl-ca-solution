"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "../../lib/auth/server";
import { getDatabase } from "../../lib/dashboard/postgres/pool";
import { applyBulkTaskChange, completeOfficeTask } from "../../lib/tasks/repository";
import { completeTodo } from "../../lib/todos/repository";
import { applyBulkWorkChange, completeWorkItem } from "../../lib/work/repository";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CALENDAR_HOME = "/?workspace=calendar";

/**
 * The permission each kind of item is governed by. Acting from the calendar is
 * a faster route to the same act, never a way around the rule that governs it.
 */
const PERMISSION_BY_KIND = {
  work: "work:write",
  task: "tasks:assign",
  // A personal to-do is the reader's own; reading the dashboard is the bar.
  todo: "dashboard:read",
} as const;

type ItemKind = keyof typeof PERMISSION_BY_KIND;

function itemKind(value: FormDataEntryValue | null): ItemKind | null {
  return value === "work" || value === "task" || value === "todo" ? value : null;
}

/**
 * Only a calendar view may be returned to.
 *
 * The value arrives in a form field, so it is attacker-controlled; echoing it
 * into a redirect unchecked would turn every inline action into an open
 * redirect. Everything else falls back to the calendar's own home.
 */
function safeReturnPath(value: FormDataEntryValue | null): string {
  if (typeof value !== "string" || !value.startsWith(CALENDAR_HOME)) return CALENDAR_HOME;
  // A newline or a second "?" would let a crafted value graft another target on.
  return /[\s\\]/.test(value) || value.includes("#") ? CALENDAR_HOME : value;
}

function withNotice(returnTo: string, notice: string) {
  return `${returnTo}${returnTo.includes("?") ? "&" : "?"}calendarNotice=${notice}`;
}

/**
 * Marks one item done without leaving the calendar.
 *
 * Each kind routes to the repository function its own workspace uses, so the
 * audit trail, the recurrence follow-on and the completed-state checks are
 * identical whether the click happened here or on the item's own page.
 */
export async function completeCalendarItemAction(formData: FormData) {
  const kind = itemKind(formData.get("kind"));
  const itemId = String(formData.get("itemId") ?? "");
  const returnTo = safeReturnPath(formData.get("returnTo"));
  if (!kind || !UUID_PATTERN.test(itemId)) redirect(withNotice(returnTo, "invalid"));

  const session = await requirePermission(PERMISSION_BY_KIND[kind], returnTo);
  const database = getDatabase();
  try {
    if (kind === "work") await completeWorkItem(database, session.tenantId, session.userId, itemId);
    else if (kind === "task") await completeOfficeTask(database, session.tenantId, session.userId, itemId);
    else await completeTodo(database, session.tenantId, session.userId, itemId);
  } catch {
    redirect(withNotice(returnTo, "failed"));
  }
  revalidatePath("/");
  redirect(withNotice(returnTo, "completed"));
}

/**
 * Moves one item to another member.
 *
 * Routed through the bulk planner rather than a direct update: it already holds
 * the separation-of-duties and capability checks, and a single reassignment
 * must not be allowed to do what a batch of one would be refused.
 */
export async function reassignCalendarItemAction(formData: FormData) {
  const kind = itemKind(formData.get("kind"));
  const itemId = String(formData.get("itemId") ?? "");
  const memberId = String(formData.get("memberId") ?? "");
  const returnTo = safeReturnPath(formData.get("returnTo"));
  if (!kind || kind === "todo" || !UUID_PATTERN.test(itemId) || !UUID_PATTERN.test(memberId)) {
    redirect(withNotice(returnTo, "invalid"));
  }

  const session = await requirePermission(PERMISSION_BY_KIND[kind], returnTo);
  const database = getDatabase();
  try {
    const plan = kind === "work"
      ? await applyBulkWorkChange(database, session.tenantId, session.userId, [itemId], { kind: "assignee", memberId })
      : await applyBulkTaskChange(database, session.tenantId, session.userId, [itemId], { kind: "assignee", memberId });
    // The planner skips what it may not change, with a reason. Reporting that
    // as success would leave the reader believing the item had moved.
    if (!plan.apply.length) redirect(withNotice(returnTo, "refused"));
  } catch (error) {
    // `redirect` signals by throwing; re-throwing keeps the refusal above.
    if (error && typeof error === "object" && "digest" in error) throw error;
    redirect(withNotice(returnTo, "failed"));
  }
  revalidatePath("/");
  redirect(withNotice(returnTo, "reassigned"));
}
