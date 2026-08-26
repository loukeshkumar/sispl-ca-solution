/**
 * Confirmations for mutations that redirect.
 *
 * A redirecting Server Action cannot call back into the browser, so it appends a
 * `toast` key to its destination and the client resolves the key here. The URL
 * carries a key and never the message itself: rendering arbitrary text from a
 * query string would let any link put words in the application's mouth.
 */
export const toastMessages = {
  "attendance-clocked": "Attendance recorded.",
  "attendance-decided": "Attendance request reviewed.",
  "attendance-locked": "Attendance period locked.",
  "attendance-quota-blocked": "That leave exceeds the employee's entitlement. Reload the queue and record a reason to approve it anyway.",
  "attendance-requested": "Request submitted for review.",
  "client-archived": "Client archived. History stays available read-only.",
  "document-cancelled": "Document request cancelled.",
  "document-requested": "Document request raised.",
  "document-uploaded": "Document uploaded.",
  "employee-access": "Login access provisioned.",
  "employee-disabled": "Employee access disabled.",
  "invoice-cancelled": "Invoice cancelled.",
  "invoice-created": "Draft invoice created.",
  "invoice-issued": "Invoice issued. The receivable is now open.",
  "invoice-paid": "Payment recorded.",
  "package-assigned": "Package assigned to the client.",
  "package-cancelled": "Client package cancelled.",
  "task-cancelled": "Task cancelled.",
  "task-completed": "Task completed.",
  "task-reopened": "Task reopened.",
  "work-completed": "Work item completed.",
} as const;

export type ToastKey = keyof typeof toastMessages;

/**
 * Keys that report a refusal rather than a success. An error toast waits longer
 * and announces assertively, because it is telling the reader their action did
 * not happen.
 */
const errorKeys = new Set<string>(["attendance-quota-blocked"]);

export function toastToneFor(key: string | null | undefined): "error" | "success" {
  return key && errorKeys.has(key) ? "error" : "success";
}

/** Resolves a `toast` query value, ignoring anything not on the allow-list. */
export function toastMessageFor(key: string | null | undefined): string | null {
  if (!key) return null;
  return Object.hasOwn(toastMessages, key) ? toastMessages[key as ToastKey] : null;
}
