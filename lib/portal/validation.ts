export type PortalContactInput = { legalEntityId: string; email: string; fullName: string };
export type PortalContactFieldErrors = Partial<Record<"legalEntityId" | "email" | "fullName", string>>;
export type PortalContactActionState = { error: string; fieldErrors: PortalContactFieldErrors; temporaryPassword?: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validatePortalContactFields(fields: Record<string, string | undefined>):
  | { success: true; data: PortalContactInput }
  | { success: false; fieldErrors: PortalContactFieldErrors } {
  const legalEntityId = fields.legalEntityId?.trim() ?? "";
  const email = fields.email?.trim().toLowerCase() ?? "";
  const fullName = fields.fullName?.trim().replace(/\s+/g, " ") ?? "";
  const fieldErrors: PortalContactFieldErrors = {};

  if (!UUID_PATTERN.test(legalEntityId)) fieldErrors.legalEntityId = "Select an active client.";
  if (!EMAIL_PATTERN.test(email) || email.length > 254) fieldErrors.email = "Enter a valid contact email address.";
  if (fullName.length < 2 || fullName.length > 120) fieldErrors.fullName = "Enter the contact name, between 2 and 120 characters.";

  if (Object.keys(fieldErrors).length) return { success: false, fieldErrors };
  return { success: true, data: { legalEntityId, email, fullName } };
}

export type PortalPasswordFieldErrors = Partial<Record<"password" | "confirmPassword", string>>;
export type PortalPasswordActionState = { error: string; fieldErrors: PortalPasswordFieldErrors };

export function validatePortalPassword(password: string, confirmPassword: string): PortalPasswordFieldErrors {
  const fieldErrors: PortalPasswordFieldErrors = {};
  if (password.length < 12 || password.length > 128) fieldErrors.password = "Use a password between 12 and 128 characters.";
  else if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) fieldErrors.password = "Use at least one letter and one number.";
  else if (password !== confirmPassword) fieldErrors.confirmPassword = "The passwords do not match.";
  return fieldErrors;
}
