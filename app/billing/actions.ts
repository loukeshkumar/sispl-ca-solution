"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "../../lib/auth/server";
import { getDatabase } from "../../lib/dashboard/postgres/pool";
import { BillingRepositoryError, cancelInvoice, createInvoice, issueInvoice, listInvoiceFormOptions, recordInvoicePayment, type InvoiceFormOptions } from "../../lib/billing/repository";
import { validateInvoiceFields, type InvoiceActionState, type InvoiceFormFields } from "../../lib/billing/validation";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const invoiceFields = (formData: FormData): InvoiceFormFields => Object.fromEntries(
  [...formData.entries()].filter(([, value]) => typeof value === "string").map(([key, value]) => [key, String(value)]),
);

const actionError = (error: unknown): InvoiceActionState => ({
  error: error instanceof BillingRepositoryError ? error.message : "The invoice could not be saved. Review the details and try again.",
  fieldErrors: {},
});

/** Loaded when the dialog first opens rather than on every dashboard render. */
export async function loadInvoiceFormOptions(): Promise<InvoiceFormOptions> {
  const session = await requirePermission("billing:manage", "/?workspace=billing");
  return listInvoiceFormOptions(getDatabase(), session.tenantId);
}

export async function createInvoiceAction(_previous: InvoiceActionState, formData: FormData): Promise<InvoiceActionState> {
  const session = await requirePermission("billing:manage", "/?workspace=billing");
  const validation = validateInvoiceFields(invoiceFields(formData));
  if (!validation.success) return { error: "Review the highlighted fields.", fieldErrors: validation.fieldErrors };
  let invoiceId = "";
  try {
    invoiceId = await createInvoice(getDatabase(), session.tenantId, session.userId, validation.data);
  } catch (error) {
    return actionError(error);
  }
  revalidatePath("/");
  redirect(`/billing/${invoiceId}?toast=invoice-created`);
}

async function transitionInvoice(formData: FormData, operation: "issue" | "pay" | "cancel") {
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const returnTo = UUID_PATTERN.test(invoiceId) ? `/billing/${invoiceId}` : "/?workspace=billing";
  const session = await requirePermission("billing:manage", returnTo);
  if (!UUID_PATTERN.test(invoiceId)) redirect("/?workspace=billing");
  try {
    if (operation === "issue") {
      const issueDate = String(formData.get("issueDate") ?? "");
      const dueDate = String(formData.get("dueDate") ?? "");
      if (!DATE_PATTERN.test(issueDate) || !DATE_PATTERN.test(dueDate) || dueDate < issueDate || issueDate < "2000-01-01") {
        redirect(`${returnTo}?billingError=dates`);
      }
      await issueInvoice(getDatabase(), session.tenantId, session.userId, invoiceId, { issueDate, dueDate });
    } else if (operation === "pay") {
      const paymentReference = String(formData.get("paymentReference") ?? "").trim().slice(0, 200);
      await recordInvoicePayment(getDatabase(), session.tenantId, session.userId, invoiceId, paymentReference);
    } else {
      const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);
      if (reason.length < 3) redirect(`${returnTo}?billingError=reason`);
      await cancelInvoice(getDatabase(), session.tenantId, session.userId, invoiceId, reason);
    }
  } catch (error) {
    if (error instanceof BillingRepositoryError) redirect(`${returnTo}?billingError=state`);
    throw error;
  }
  revalidatePath("/");
  revalidatePath(returnTo);
  redirect(`${returnTo}?toast=invoice-${operation === "issue" ? "issued" : operation === "pay" ? "paid" : "cancelled"}`);
}

export async function issueInvoiceAction(formData: FormData) {
  return transitionInvoice(formData, "issue");
}

export async function recordInvoicePaymentAction(formData: FormData) {
  return transitionInvoice(formData, "pay");
}

export async function cancelInvoiceAction(formData: FormData) {
  return transitionInvoice(formData, "cancel");
}
