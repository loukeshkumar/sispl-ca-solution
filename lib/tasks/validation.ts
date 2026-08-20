export const taskPriorities = ["low", "normal", "high", "urgent"] as const;
export const taskStatuses = ["todo", "in_progress", "waiting", "review", "completed", "cancelled"] as const;
export const taskSelfStatuses = ["todo", "in_progress", "waiting", "review"] as const;

export type TaskPriority = typeof taskPriorities[number];
export type TaskStatus = typeof taskStatuses[number];
export type TaskSelfStatus = typeof taskSelfStatuses[number];

export type OfficeTaskInput = {
  assigneeId: string;
  blockerNote: string;
  description: string;
  dueDate: string;
  /** Typed per task. Null means the task is unestimated. */
  estimateMinutes: number | null;
  legalEntityId: string | null;
  priority: TaskPriority;
  reviewerId: string | null;
  status: TaskStatus;
  title: string;
  workItemId: string | null;
};

export type TaskSelfUpdateInput = { blockerNote: string; status: TaskSelfStatus };
export type OfficeTaskFormFields = Record<string, string | undefined>;
export type OfficeTaskFieldErrors = Partial<Record<keyof OfficeTaskInput, string>>;
export type TaskActionState = { error: string; fieldErrors: OfficeTaskFieldErrors };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (fields: OfficeTaskFormFields, key: string) => fields[key]?.trim() ?? "";
const validDateKey = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};

export function validateOfficeTaskFields(fields: OfficeTaskFormFields):
  | { success: true; data: OfficeTaskInput }
  | { success: false; fieldErrors: OfficeTaskFieldErrors } {
  const title = text(fields, "title").replace(/\s+/g, " ");
  const description = text(fields, "description");
  const assigneeId = text(fields, "assigneeId");
  const reviewerId = text(fields, "reviewerId");
  const priority = text(fields, "priority");
  const status = text(fields, "status");
  const dueDate = text(fields, "dueDate");
  const blockerNote = text(fields, "blockerNote");
  const legalEntityId = text(fields, "legalEntityId");
  const workItemId = text(fields, "workItemId");
  const fieldErrors: OfficeTaskFieldErrors = {};

  if (title.length < 3 || title.length > 160) fieldErrors.title = "Enter a task title between 3 and 160 characters.";
  if (description.length > 1_500) fieldErrors.description = "Description cannot exceed 1,500 characters.";
  if (!UUID_PATTERN.test(assigneeId)) fieldErrors.assigneeId = "Select an active assignee.";
  if (reviewerId && !UUID_PATTERN.test(reviewerId)) fieldErrors.reviewerId = "Select a valid reviewer.";
  if (reviewerId && reviewerId === assigneeId) fieldErrors.reviewerId = "Reviewer must be different from the assignee.";
  if (!taskPriorities.includes(priority as TaskPriority)) fieldErrors.priority = "Select a valid priority.";
  if (!taskStatuses.includes(status as TaskStatus)) fieldErrors.status = "Select a valid task status.";
  if (!validDateKey(dueDate)) fieldErrors.dueDate = "Enter a valid due date.";
  if (blockerNote.length > 500) fieldErrors.blockerNote = "Blocker note cannot exceed 500 characters.";
  if (status === "waiting" && blockerNote.length < 3) fieldErrors.blockerNote = "Explain what is awaited before using Waiting status.";
  if (legalEntityId && !UUID_PATTERN.test(legalEntityId)) fieldErrors.legalEntityId = "Select a valid client.";
  if (workItemId && !UUID_PATTERN.test(workItemId)) fieldErrors.workItemId = "Select a valid compliance work item.";

  const estimateRaw = text(fields, "estimateMinutes");
  let estimateMinutes: number | null = null;
  if (estimateRaw) {
    const parsed = Number(estimateRaw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100000) {
      fieldErrors.estimateMinutes = "Estimate must be a whole number of minutes between 1 and 100000.";
    } else {
      estimateMinutes = parsed;
    }
  }

  if (Object.keys(fieldErrors).length) return { success: false, fieldErrors };
  return {
    success: true,
    data: {
      assigneeId,
      blockerNote,
      description,
      dueDate,
      estimateMinutes,
      legalEntityId: legalEntityId || null,
      priority: priority as TaskPriority,
      reviewerId: reviewerId || null,
      status: status as TaskStatus,
      title,
      workItemId: workItemId || null,
    },
  };
}

export function validateTaskSelfUpdateFields(fields: OfficeTaskFormFields):
  | { success: true; data: TaskSelfUpdateInput }
  | { success: false; fieldErrors: OfficeTaskFieldErrors } {
  const status = text(fields, "status");
  const blockerNote = text(fields, "blockerNote");
  const fieldErrors: OfficeTaskFieldErrors = {};
  if (!taskSelfStatuses.includes(status as TaskSelfStatus)) fieldErrors.status = "Select an available task status.";
  if (status === "waiting" && blockerNote.length < 3) fieldErrors.blockerNote = "Explain what is blocking this task.";
  if (blockerNote.length > 500) fieldErrors.blockerNote = "Blocker note cannot exceed 500 characters.";
  if (Object.keys(fieldErrors).length) return { success: false, fieldErrors };
  return { success: true, data: { blockerNote, status: status as TaskSelfStatus } };
}

export const taskStatusLabel = (status: string) => ({
  todo: "To do",
  in_progress: "In progress",
  waiting: "Waiting",
  review: "Review",
  completed: "Completed",
  cancelled: "Cancelled",
})[status] ?? status;
