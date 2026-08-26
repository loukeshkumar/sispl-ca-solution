import { holdsMembership, isQualification, QUALIFICATION_LABELS, type Qualification } from "./capability";

export type EmployeeInput = {
  designation: string;
  email: string;
  fullName: string;
  joiningDate: string;
  membershipNumber: string;
  mobileNumber: string;
  notes: string;
  qualification: Qualification;
  qualifiedOn: string | null;
  roleDefinitionId?: string;
  roleKey?: "firm_administrator" | "partner" | "manager" | "associate";
};

export type EmployeeFormFields = Record<string, string | undefined>;
export type EmployeeFieldErrors = Partial<Record<keyof EmployeeInput, string>>;
export type EmployeeActionState = { error: string; fieldErrors: EmployeeFieldErrors; temporaryPassword?: string };

const validDateKey = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
};

const text = (fields: EmployeeFormFields, key: string) => fields[key]?.trim() ?? "";

/** ICAI issues six digits. Nothing else is a membership number. */
const MEMBERSHIP_PATTERN = /^[0-9]{6}$/;

export function validateEmployeeFields(fields: EmployeeFormFields):
  | { success: true; data: EmployeeInput }
  | { success: false; fieldErrors: EmployeeFieldErrors } {
  const fullName = text(fields, "fullName").replace(/\s+/g, " ");
  const email = text(fields, "email").toLowerCase();
  const roleDefinitionId = text(fields, "roleDefinitionId");
  const designation = text(fields, "designation").replace(/\s+/g, " ");
  const joiningDate = text(fields, "joiningDate");
  const rawMobile = text(fields, "mobileNumber");
  const mobileNumber = rawMobile.replace(/[\s()-]/g, "");
  const notes = text(fields, "notes");
  const qualification = text(fields, "qualification") || "other";
  const membershipNumber = text(fields, "membershipNumber").replace(/\s/g, "");
  const rawQualifiedOn = text(fields, "qualifiedOn");
  const qualifiedOn = rawQualifiedOn === "" ? null : rawQualifiedOn;
  const fieldErrors: EmployeeFieldErrors = {};

  if (fullName.length < 2 || fullName.length > 120) fieldErrors.fullName = "Enter a name between 2 and 120 characters.";
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) fieldErrors.email = "Enter a valid email address.";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(roleDefinitionId)) fieldErrors.roleDefinitionId = "Select a valid access role.";
  if (designation.length < 2 || designation.length > 100) fieldErrors.designation = "Enter a designation between 2 and 100 characters.";
  if (!validDateKey(joiningDate)) fieldErrors.joiningDate = "Enter a valid joining date.";
  if (mobileNumber && !/^\+?[0-9]{10,15}$/.test(mobileNumber)) fieldErrors.mobileNumber = "Enter a valid 10 to 15 digit mobile number.";
  if (notes.length > 500) fieldErrors.notes = "Employment notes cannot exceed 500 characters.";
  if (!isQualification(qualification)) fieldErrors.qualification = "Select a qualification.";
  else if (membershipNumber && !holdsMembership(qualification)) {
    fieldErrors.membershipNumber = `A membership number belongs to a ${QUALIFICATION_LABELS.ca}. Clear it, or change the qualification.`;
  } else if (membershipNumber && !MEMBERSHIP_PATTERN.test(membershipNumber)) {
    fieldErrors.membershipNumber = "Enter the six-digit ICAI membership number.";
  }
  // An articled assistant is, by definition, someone who has not qualified yet.
  if (qualifiedOn && qualification === "articled") fieldErrors.qualifiedOn = "An articled assistant has not qualified yet. Leave this blank.";
  else if (qualifiedOn && !validDateKey(qualifiedOn)) fieldErrors.qualifiedOn = "Enter a valid qualification date, or leave it blank.";

  if (Object.keys(fieldErrors).length) return { success: false, fieldErrors };
  return {
    success: true,
    data: {
      designation, email, fullName, joiningDate, membershipNumber, mobileNumber, notes,
      qualification: qualification as Qualification, qualifiedOn, roleDefinitionId,
    },
  };
}
