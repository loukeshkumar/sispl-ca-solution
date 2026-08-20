import { todoRecurrenceRules, type TodoRecurrenceRule } from "./recurrence";

export const todoPriorities = ["low", "normal", "high", "urgent"] as const;
export const todoStatuses = ["open", "completed", "archived"] as const;

export type TodoPriority = typeof todoPriorities[number];
export type TodoStatus = typeof todoStatuses[number];
export type TodoInput = {
  title: string;
  notes: string;
  dueDate: string | null;
  dueTime: string | null;
  priority: TodoPriority;
  category: string;
  recurrenceRule: TodoRecurrenceRule | null;
  recurrenceInterval: number | null;
};
export type TodoFormFields = Record<string, string | undefined>;
export type TodoFieldErrors = Partial<Record<keyof TodoInput, string>>;
export type TodoActionState = { error: string; fieldErrors: TodoFieldErrors };

const validDateKey = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};

export function validateTodoFields(fields: TodoFormFields):
  | { success: true; data: TodoInput }
  | { success: false; fieldErrors: TodoFieldErrors } {
  const title = (fields.title ?? "").trim().replace(/\s+/g, " ");
  const notes = (fields.notes ?? "").trim();
  const dueDate = (fields.dueDate ?? "").trim();
  const dueTime = (fields.dueTime ?? "").trim();
  const priority = (fields.priority ?? "").trim();
  const category = (fields.category ?? "").trim().replace(/\s+/g, " ");
  const fieldErrors: TodoFieldErrors = {};

  if (title.length < 1 || title.length > 160) fieldErrors.title = "Enter a title between 1 and 160 characters.";
  if (notes.length > 2_000) fieldErrors.notes = "Notes cannot exceed 2,000 characters.";
  if (category.length > 40) fieldErrors.category = "Category cannot exceed 40 characters.";
  if (dueDate && !validDateKey(dueDate)) fieldErrors.dueDate = "Enter a valid due date.";
  if (dueTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(dueTime)) fieldErrors.dueTime = "Enter a valid time.";
  if (dueTime && !dueDate) fieldErrors.dueTime = "Choose a due date before adding a time.";
  if (!todoPriorities.includes(priority as TodoPriority)) fieldErrors.priority = "Select a valid priority.";

  const rule = (fields.recurrenceRule ?? "").trim();
  const intervalRaw = (fields.recurrenceInterval ?? "").trim();
  let recurrenceRule: TodoRecurrenceRule | null = null;
  let recurrenceInterval: number | null = null;
  if (rule) {
    if (!todoRecurrenceRules.includes(rule as TodoRecurrenceRule)) {
      fieldErrors.recurrenceRule = "Select a valid repeat.";
    } else if (!dueDate) {
      // The database enforces this too, but a check constraint only speaks
      // after a round trip.
      fieldErrors.recurrenceRule = "Choose a due date before setting a repeat.";
    } else {
      const parsed = intervalRaw ? Number(intervalRaw) : 1;
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
        fieldErrors.recurrenceInterval = "Repeat every 1 to 365.";
      } else {
        recurrenceRule = rule as TodoRecurrenceRule;
        recurrenceInterval = parsed;
      }
    }
  }

  if (Object.keys(fieldErrors).length) return { success: false, fieldErrors };
  return {
    success: true,
    data: {
      title,
      notes,
      dueDate: dueDate || null,
      dueTime: dueTime || null,
      priority: priority as TodoPriority,
      category,
      recurrenceRule,
      recurrenceInterval,
    },
  };
}

export const todoPriorityLabel = (priority: string) => ({
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
})[priority] ?? priority;
