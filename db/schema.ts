import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  legalName: text("legal_name").notNull(),
  displayName: text("display_name").notNull(),
  slug: text("slug").notNull(),
  status: text("status").notNull().default("active"),
  /**
   * The firm's own GST registration. Null while the firm is unregistered, in
   * which case it issues a bill of supply rather than a tax invoice.
   *
   * One registration, which is the ordinary case for a practice. A firm with
   * registrations in several states would need a table; this is deliberately
   * not one, and the constraint below keeps the state and the GSTIN agreeing.
   */
  gstin: text("gstin"),
  stateCode: text("state_code"),
  addressLine: text("address_line").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("tenants_slug_lower_unique").on(sql`lower(${table.slug})`),
  check("tenants_status_check", sql`${table.status} in ('trial', 'active', 'suspended', 'closed')`),
  check("tenants_gstin_check", sql`${table.gstin} is null or ${table.gstin} ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'`),
  check("tenants_state_code_check", sql`${table.stateCode} is null or ${table.stateCode} ~ '^[0-9]{2}$'`),
  // The first two digits of a GSTIN are the state that issued it. Letting them
  // disagree would put an invoice in the wrong state on its face.
  check("tenants_gstin_state_check", sql`${table.gstin} is null or ${table.stateCode} is null or left(${table.gstin}, 2) = ${table.stateCode}`),
  check("tenants_address_check", sql`length(${table.addressLine}) <= 300`),
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull(),
  fullName: text("full_name").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("users_email_lower_unique").on(sql`lower(${table.email})`),
  check("users_status_check", sql`${table.status} in ('invited', 'active', 'disabled')`),
]);

export const roleDefinitions = pgTable("role_definitions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  roleClass: text("role_class").notNull(),
  legacyRoleKey: text("legacy_role_key").notNull(),
  isSystem: boolean("is_system").notNull().default(false),
  status: text("status").notNull().default("active"),
  version: integer("version").notNull().default(1),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("role_definitions_tenant_id_unique").on(table.tenantId, table.id),
  uniqueIndex("role_definitions_tenant_key_lower_unique").on(table.tenantId, sql`lower(${table.key})`),
  uniqueIndex("role_definitions_tenant_name_lower_unique").on(table.tenantId, sql`lower(${table.name})`),
  index("role_definitions_tenant_class_status_idx").on(table.tenantId, table.roleClass, table.status),
  check("role_definitions_class_check", sql`${table.roleClass} in ('admin', 'employee')`),
  check("role_definitions_legacy_role_check", sql`${table.legacyRoleKey} in ('partner', 'manager', 'associate')`),
  check("role_definitions_status_check", sql`${table.status} in ('active', 'archived')`),
  check("role_definitions_version_check", sql`${table.version} > 0`),
]);

export const userCredentials = pgTable("user_credentials", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  passwordHash: text("password_hash").notNull(),
  failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }).notNull().defaultNow(),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
}, (table) => [
  check("user_credentials_failed_attempts_check", sql`${table.failedLoginAttempts} >= 0`),
]);

export const tenantMemberships = pgTable("tenant_memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  roleKey: text("role_key").notNull(),
  accessClass: text("access_class").notNull().default("employee"),
  roleDefinitionId: uuid("role_definition_id"),
  authorizationVersion: integer("authorization_version").notNull().default(1),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("tenant_memberships_tenant_user_unique").on(table.tenantId, table.userId),
  unique("tenant_memberships_tenant_id_unique").on(table.tenantId, table.id),
  foreignKey({ name: "tenant_memberships_role_definition_fk", columns: [table.tenantId, table.roleDefinitionId], foreignColumns: [roleDefinitions.tenantId, roleDefinitions.id] }),
  index("tenant_memberships_tenant_idx").on(table.tenantId),
  index("tenant_memberships_role_definition_idx").on(table.tenantId, table.roleDefinitionId),
  check("tenant_memberships_role_check", sql`${table.roleKey} in ('firm_administrator', 'partner', 'manager', 'associate')`),
  check("tenant_memberships_access_class_check", sql`${table.accessClass} in ('super_admin', 'admin', 'employee')`),
  check("tenant_memberships_authorization_version_check", sql`${table.authorizationVersion} > 0`),
  check("tenant_memberships_super_admin_check", sql`(${table.accessClass} = 'super_admin' and ${table.roleKey} = 'firm_administrator' and ${table.roleDefinitionId} is null) or ${table.accessClass} <> 'super_admin'`),
  check("tenant_memberships_status_check", sql`${table.status} in ('invited', 'active', 'disabled')`),
]);

export const rolePermissions = pgTable("role_permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  roleDefinitionId: uuid("role_definition_id").notNull(),
  permissionKey: text("permission_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("role_permissions_role_permission_unique").on(table.tenantId, table.roleDefinitionId, table.permissionKey),
  foreignKey({ name: "role_permissions_role_tenant_fk", columns: [table.tenantId, table.roleDefinitionId], foreignColumns: [roleDefinitions.tenantId, roleDefinitions.id] }),
  index("role_permissions_role_idx").on(table.tenantId, table.roleDefinitionId),
]);

export const employeeProfiles = pgTable("employee_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  employeeCode: text("employee_code").notNull(),
  designation: text("designation").notNull(),
  // What the person is, professionally. `designation` already carries the firm
  // grade ("Assistant Manager"); this is the qualification behind it, which is
  // what decides who may sign a statutory report rather than merely prepare it.
  qualification: text("qualification").notNull().default("other"),
  /** ICAI membership number. Only a qualified member has one. */
  membershipNumber: text("membership_number").notNull().default(""),
  qualifiedOn: date("qualified_on", { mode: "string" }),
  /**
   * Which CPE obligation a member falls under. Only meaningful for a Chartered
   * Accountant; everybody else has a training log and no compliance test.
   */
  cpeCategory: text("cpe_category").notNull().default("in_practice"),
  mobileNumber: text("mobile_number").notNull().default(""),
  joiningDate: date("joining_date", { mode: "string" }).notNull(),
  employmentEndDate: date("employment_end_date", { mode: "string" }),
  /**
   * Where the person is in their employment. Defaults to `confirmed` so every
   * profile that predates this column reads correctly without a data migration
   * guessing at history; the joiner form starts a new employee on probation.
   */
  employmentStage: text("employment_stage").notNull().default("confirmed"),
  probationEndDate: date("probation_end_date", { mode: "string" }),
  confirmedOn: date("confirmed_on", { mode: "string" }),
  noticeStartDate: date("notice_start_date", { mode: "string" }),
  exitReason: text("exit_reason").notNull().default(""),
  /** Why the firm exited somebody with clearance items still outstanding. */
  exitClearanceNote: text("exit_clearance_note").notNull().default(""),
  notes: text("notes").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("employee_profiles_tenant_user_unique").on(table.tenantId, table.userId),
  unique("employee_profiles_tenant_code_unique").on(table.tenantId, table.employeeCode),
  foreignKey({ name: "employee_profiles_membership_fk", columns: [table.tenantId, table.userId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("employee_profiles_tenant_idx").on(table.tenantId),
  check("employee_profiles_employment_dates_check", sql`${table.employmentEndDate} is null or ${table.employmentEndDate} >= ${table.joiningDate}`),
  check("employee_profiles_qualification_check", sql`${table.qualification} in ('ca', 'cma', 'cs', 'llb', 'ca_inter', 'articled', 'other')`),
  // Six digits, the shape ICAI issues. Anyone who is not a member has none, and
  // a membership number on a non-member would be a claim the firm cannot support.
  check("employee_profiles_membership_check", sql`${table.membershipNumber} = '' or (${table.qualification} = 'ca' and ${table.membershipNumber} ~ '^[0-9]{6}$')`),
  // An articled assistant is by definition someone who has not qualified yet.
  check("employee_profiles_qualified_on_check", sql`${table.qualifiedOn} is null or ${table.qualification} <> 'articled'`),
  check("employee_profiles_stage_check", sql`${table.employmentStage} in ('probation', 'confirmed', 'notice', 'exited')`),
  check("employee_profiles_cpe_category_check", sql`${table.cpeCategory} in ('in_practice', 'not_in_practice', 'exempt')`),
  // Each stage has to be evidenced by the date that put the person in it.
  check("employee_profiles_confirmed_state_check", sql`${table.employmentStage} <> 'confirmed' or ${table.confirmedOn} is not null`),
  check("employee_profiles_notice_state_check", sql`${table.employmentStage} <> 'notice' or ${table.noticeStartDate} is not null`),
  check("employee_profiles_exited_state_check", sql`${table.employmentStage} <> 'exited' or ${table.employmentEndDate} is not null`),
  check("employee_profiles_probation_end_check", sql`${table.probationEndDate} is null or ${table.probationEndDate} >= ${table.joiningDate}`),
  check("employee_profiles_confirmed_on_check", sql`${table.confirmedOn} is null or ${table.confirmedOn} >= ${table.joiningDate}`),
  check("employee_profiles_notice_start_check", sql`${table.noticeStartDate} is null or ${table.noticeStartDate} >= ${table.joiningDate}`),
  check("employee_profiles_exit_text_check", sql`length(${table.exitReason}) <= 300 and length(${table.exitClearanceNote}) <= 500`),
]);

/**
 * What each person is trusted to do, service by service.
 *
 * Recorded against the firm's own service master rather than as free-text tags,
 * because that is the axis work is already raised on — a work item carries a
 * service, so "who can do this" becomes a lookup instead of a conversation.
 *
 * The levels are a ladder, not a set: anyone who can review can also prepare.
 * Ordering them in one place (`lib/team/capability.ts`) keeps that true.
 */
export const employeeCapabilities = pgTable("employee_capabilities", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  employeeUserId: uuid("employee_user_id").notNull(),
  /** A code from `service_catalog`, upper-case as the catalogue stores it. */
  serviceCode: text("service_code").notNull(),
  level: text("level").notNull(),
  /** Who judged it. A self-declared capability is not a control. */
  assessedByUserId: uuid("assessed_by_user_id").notNull(),
  assessedOn: date("assessed_on", { mode: "string" }).notNull(),
  note: text("note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("employee_capabilities_tenant_id_unique").on(table.tenantId, table.id),
  // Codes are upper-cased on the way in (the check constraint enforces the
  // shape), so a plain unique key is enough and stays usable as an upsert target.
  unique("employee_capabilities_employee_service_unique").on(table.tenantId, table.employeeUserId, table.serviceCode),
  foreignKey({ name: "employee_capabilities_employee_membership_fk", columns: [table.tenantId, table.employeeUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "employee_capabilities_assessor_membership_fk", columns: [table.tenantId, table.assessedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("employee_capabilities_service_level_idx").on(table.tenantId, table.serviceCode, table.level),
  check("employee_capabilities_service_code_check", sql`${table.serviceCode} ~ '^[A-Z0-9][A-Z0-9_-]{1,19}$'`),
  check("employee_capabilities_level_check", sql`${table.level} in ('learning', 'prepare', 'review', 'sign')`),
  check("employee_capabilities_note_check", sql`length(${table.note}) <= 500`),
  // Nobody assesses their own capability; that is the whole point of recording it.
  check("employee_capabilities_assessor_check", sql`${table.assessedByUserId} <> ${table.employeeUserId}`),
]);

export const userSessions = pgTable("user_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  membershipId: uuid("membership_id").notNull().references(() => tenantMemberships.id),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("user_sessions_token_hash_unique").on(table.tokenHash),
  index("user_sessions_membership_idx").on(table.membershipId),
  index("user_sessions_expiry_idx").on(table.expiresAt),
]);

export const authRateLimits = pgTable("auth_rate_limits", {
  keyHash: text("key_hash").primaryKey(),
  attemptCount: integer("attempt_count").notNull().default(0),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull().defaultNow(),
  blockedUntil: timestamp("blocked_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("auth_rate_limits_updated_idx").on(table.updatedAt),
  check("auth_rate_limits_attempt_count_check", sql`${table.attemptCount} >= 0`),
]);

export const clientGroups = pgTable("client_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  relationshipOwnerId: uuid("relationship_owner_id"),
  riskStatus: text("risk_status").notNull().default("watch"),
  healthScore: integer("health_score").notNull().default(50),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("client_groups_tenant_name_unique").on(table.tenantId, table.name),
  unique("client_groups_tenant_id_unique").on(table.tenantId, table.id),
  foreignKey({ name: "client_groups_owner_membership_fk", columns: [table.tenantId, table.relationshipOwnerId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("client_groups_tenant_idx").on(table.tenantId),
  check("client_groups_risk_check", sql`${table.riskStatus} in ('healthy', 'watch', 'critical')`),
  check("client_groups_health_score_check", sql`${table.healthScore} between 0 and 100`),
]);

export const legalEntities = pgTable("legal_entities", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  clientGroupId: uuid("client_group_id").notNull(),
  legalName: text("legal_name").notNull(),
  displayName: text("display_name").notNull(),
  entityType: text("entity_type").notNull(),
  maskedPan: text("masked_pan").notNull(),
  city: text("city").notNull(),
  relationshipStart: date("relationship_start", { mode: "string" }).notNull(),
  /** The client's GST registration. Null where they are unregistered. */
  gstin: text("gstin"),
  /** Where the supply is treated as made. Defaults to the client's own state. */
  stateCode: text("state_code"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("legal_entities_tenant_group_name_unique").on(table.tenantId, table.clientGroupId, table.legalName),
  unique("legal_entities_tenant_id_unique").on(table.tenantId, table.id),
  foreignKey({ name: "legal_entities_group_tenant_fk", columns: [table.tenantId, table.clientGroupId], foreignColumns: [clientGroups.tenantId, clientGroups.id] }),
  index("legal_entities_tenant_idx").on(table.tenantId),
  check("legal_entities_gstin_check", sql`${table.gstin} is null or ${table.gstin} ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'`),
  check("legal_entities_state_code_check", sql`${table.stateCode} is null or ${table.stateCode} ~ '^[0-9]{2}$'`),
  check("legal_entities_gstin_state_check", sql`${table.gstin} is null or ${table.stateCode} is null or left(${table.gstin}, 2) = ${table.stateCode}`),
  // `prospect` is where a client now starts: known to the firm, not yet
  // accepted, and refused by every gate that asks for an active client.
  check("legal_entities_status_check", sql`${table.status} in ('prospect', 'active', 'archived', 'declined')`),
]);

/**
 * Whether the firm decided to take this client on, and on what basis.
 *
 * A client was created with a name and a start date and was active from that
 * moment. Nothing recorded that anybody had checked for a conflict, considered
 * independence, seen a PAN, or written to the outgoing auditor — all of which a
 * peer reviewer asks for and the ICAI Code requires. The first evidence that a
 * client had been accepted was that work existed for them.
 */
export const clientAcceptances = pgTable("client_acceptances", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  legalEntityId: uuid("legal_entity_id").notNull(),
  status: text("status").notNull().default("in_progress"),
  /** A partner's decision, not the person who did the checking. */
  decidedByUserId: uuid("decided_by_user_id"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note").notNull().default(""),
  createdByUserId: uuid("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("client_acceptances_tenant_id_unique").on(table.tenantId, table.id),
  unique("client_acceptances_entity_unique").on(table.tenantId, table.legalEntityId),
  foreignKey({ name: "client_acceptances_entity_tenant_fk", columns: [table.tenantId, table.legalEntityId], foreignColumns: [legalEntities.tenantId, legalEntities.id] }),
  foreignKey({ name: "client_acceptances_decider_membership_fk", columns: [table.tenantId, table.decidedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "client_acceptances_creator_membership_fk", columns: [table.tenantId, table.createdByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("client_acceptances_status_idx").on(table.tenantId, table.status),
  check("client_acceptances_status_check", sql`${table.status} in ('in_progress', 'accepted', 'declined')`),
  // A decision has an author and a date, and declining says why.
  check("client_acceptances_decision_check", sql`
    (${table.status} = 'in_progress' and ${table.decidedAt} is null and ${table.decidedByUserId} is null)
    or (${table.status} = 'accepted' and ${table.decidedAt} is not null and ${table.decidedByUserId} is not null)
    or (${table.status} = 'declined' and ${table.decidedAt} is not null and ${table.decidedByUserId} is not null and length(trim(${table.decisionNote})) > 0)
  `),
  check("client_acceptances_note_check", sql`length(${table.decisionNote}) <= 1000`),
]);

/**
 * One named check, its outcome, and who performed it.
 *
 * Separate rows rather than columns on the acceptance because each carries its
 * own author and date: "Nisha cleared the conflict check on the 8th" is the
 * fact, and a boolean beside a single signature is not.
 */
export const clientAcceptanceChecks = pgTable("client_acceptance_checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  legalEntityId: uuid("legal_entity_id").notNull(),
  checkKey: text("check_key").notNull(),
  outcome: text("outcome").notNull(),
  /** Required where the outcome is anything other than a clean pass. */
  note: text("note").notNull().default(""),
  checkedByUserId: uuid("checked_by_user_id").notNull(),
  checkedOn: date("checked_on", { mode: "string" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("client_acceptance_checks_tenant_id_unique").on(table.tenantId, table.id),
  unique("client_acceptance_checks_entity_key_unique").on(table.tenantId, table.legalEntityId, table.checkKey),
  foreignKey({ name: "client_acceptance_checks_entity_tenant_fk", columns: [table.tenantId, table.legalEntityId], foreignColumns: [legalEntities.tenantId, legalEntities.id] }),
  foreignKey({ name: "client_acceptance_checks_checker_membership_fk", columns: [table.tenantId, table.checkedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("client_acceptance_checks_entity_idx").on(table.tenantId, table.legalEntityId),
  check("client_acceptance_checks_key_check", sql`${table.checkKey} in ('conflict', 'independence', 'kyc', 'predecessor', 'integrity')`),
  check("client_acceptance_checks_outcome_check", sql`${table.outcome} in ('cleared', 'concern', 'not_applicable')`),
  // Anything other than a clean pass has to say what it found, or the outcome
  // is a word nobody can act on.
  check("client_acceptance_checks_note_check", sql`
    (${table.outcome} = 'cleared' and length(${table.note}) <= 1000)
    or (${table.outcome} <> 'cleared' and length(trim(${table.note})) between 3 and 1000)
  `),
]);

/**
 * The terms the client agreed to, and what they cover.
 *
 * SA 210 wants the terms of an engagement in writing. The system held none of
 * it, so "is this audit covered by a signed letter" was answered by opening a
 * PDF, if somebody could find it.
 *
 * Scoped by service and by period because that is the question actually asked:
 * not "is there a letter" but "does it cover this work".
 */
export const engagementLetters = pgTable("engagement_letters", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  legalEntityId: uuid("legal_entity_id").notNull(),
  periodFrom: date("period_from", { mode: "string" }).notNull(),
  periodTo: date("period_to", { mode: "string" }).notNull(),
  feeBasis: text("fee_basis").notNull().default("fixed_retainer"),
  status: text("status").notNull().default("draft"),
  issuedOn: date("issued_on", { mode: "string" }),
  signedOn: date("signed_on", { mode: "string" }),
  /** The signed copy, once it exists. */
  documentId: uuid("document_id"),
  note: text("note").notNull().default(""),
  createdByUserId: uuid("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("engagement_letters_tenant_id_unique").on(table.tenantId, table.id),
  foreignKey({ name: "engagement_letters_entity_tenant_fk", columns: [table.tenantId, table.legalEntityId], foreignColumns: [legalEntities.tenantId, legalEntities.id] }),
  foreignKey({ name: "engagement_letters_creator_membership_fk", columns: [table.tenantId, table.createdByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("engagement_letters_entity_idx").on(table.tenantId, table.legalEntityId, table.periodFrom),
  index("engagement_letters_status_idx").on(table.tenantId, table.status),
  check("engagement_letters_period_check", sql`${table.periodTo} > ${table.periodFrom}`),
  check("engagement_letters_status_check", sql`${table.status} in ('draft', 'issued', 'signed', 'superseded')`),
  check("engagement_letters_fee_basis_check", sql`${table.feeBasis} in ('fixed_retainer', 'per_service', 'hourly', 'other')`),
  // A letter cannot be signed before it was issued, and neither date exists
  // while it is a draft.
  check("engagement_letters_dates_check", sql`
    (${table.status} = 'draft' and ${table.issuedOn} is null and ${table.signedOn} is null)
    or (${table.status} = 'issued' and ${table.issuedOn} is not null and ${table.signedOn} is null)
    or (${table.status} in ('signed', 'superseded') and ${table.issuedOn} is not null and ${table.signedOn} is not null and ${table.signedOn} >= ${table.issuedOn})
  `),
  check("engagement_letters_note_check", sql`length(${table.note}) <= 1000`),
]);

/** The services one letter covers. A letter covering nothing covers nothing. */
export const engagementLetterServices = pgTable("engagement_letter_services", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  letterId: uuid("letter_id").notNull(),
  /** A code from `service_catalog`, upper-case as the catalogue stores it. */
  serviceCode: text("service_code").notNull(),
}, (table) => [
  unique("engagement_letter_services_letter_service_unique").on(table.tenantId, table.letterId, table.serviceCode),
  foreignKey({ name: "engagement_letter_services_letter_tenant_fk", columns: [table.tenantId, table.letterId], foreignColumns: [engagementLetters.tenantId, engagementLetters.id] }),
  index("engagement_letter_services_letter_idx").on(table.tenantId, table.letterId),
  check("engagement_letter_services_code_check", sql`${table.serviceCode} ~ '^[A-Z0-9][A-Z0-9_-]{1,19}$'`),
]);

export const clientServices = pgTable("client_services", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  legalEntityId: uuid("legal_entity_id").notNull(),
  serviceKey: text("service_key").notNull(),
  status: text("status").notNull().default("active"),
}, (table) => [
  unique("client_services_tenant_entity_service_unique").on(table.tenantId, table.legalEntityId, table.serviceKey),
  foreignKey({ name: "client_services_entity_tenant_fk", columns: [table.tenantId, table.legalEntityId], foreignColumns: [legalEntities.tenantId, legalEntities.id] }),
  index("client_services_tenant_idx").on(table.tenantId),
  check("client_services_status_check", sql`${table.status} in ('active', 'inactive')`),
]);

export const serviceCatalog = pgTable("service_catalog", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull().default(""),
  /** The SAC this service is supplied under. 998222 is accounting and audit. */
  sacCode: text("sac_code"),
  // The firm's own estimate of one occurrence. New work items copy it as their
  // budget; editing it never rewrites work already raised.
  standardMinutes: integer("standard_minutes"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("service_catalog_tenant_id_unique").on(table.tenantId, table.id),
  uniqueIndex("service_catalog_tenant_code_lower_unique").on(table.tenantId, sql`lower(${table.code})`),
  index("service_catalog_tenant_status_idx").on(table.tenantId, table.status, table.name),
  check("service_catalog_code_check", sql`${table.code} ~ '^[A-Z0-9][A-Z0-9_-]{1,19}$'`),
  check("service_catalog_status_check", sql`${table.status} in ('active', 'archived')`),
  check("service_catalog_standard_minutes_check", sql`${table.standardMinutes} is null or ${table.standardMinutes} between 1 and 100000`),
]);

export const servicePackages = pgTable("service_packages", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  billingCycle: text("billing_cycle").notNull(),
  standardFeePaise: bigint("standard_fee_paise", { mode: "number" }).notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("service_packages_tenant_id_unique").on(table.tenantId, table.id),
  uniqueIndex("service_packages_tenant_code_lower_unique").on(table.tenantId, sql`lower(${table.code})`),
  index("service_packages_tenant_status_idx").on(table.tenantId, table.status, table.name),
  check("service_packages_code_check", sql`${table.code} ~ '^[A-Z][A-Z0-9_-]{1,19}$'`),
  check("service_packages_billing_cycle_check", sql`${table.billingCycle} in ('monthly', 'quarterly', 'annual', 'one_time')`),
  check("service_packages_fee_check", sql`${table.standardFeePaise} >= 0`),
  check("service_packages_status_check", sql`${table.status} in ('active', 'archived')`),
]);

export const servicePackageItems = pgTable("service_package_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  packageId: uuid("package_id").notNull(),
  serviceId: uuid("service_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("service_package_items_package_service_unique").on(table.tenantId, table.packageId, table.serviceId),
  foreignKey({ name: "service_package_items_package_tenant_fk", columns: [table.tenantId, table.packageId], foreignColumns: [servicePackages.tenantId, servicePackages.id] }),
  foreignKey({ name: "service_package_items_service_tenant_fk", columns: [table.tenantId, table.serviceId], foreignColumns: [serviceCatalog.tenantId, serviceCatalog.id] }),
  index("service_package_items_package_idx").on(table.tenantId, table.packageId),
]);

export const clientPackageAssignments = pgTable("client_package_assignments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  legalEntityId: uuid("legal_entity_id").notNull(),
  packageId: uuid("package_id").notNull(),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  effectiveTo: date("effective_to", { mode: "string" }),
  status: text("status").notNull(),
  packageCodeSnapshot: text("package_code_snapshot").notNull(),
  packageNameSnapshot: text("package_name_snapshot").notNull(),
  billingCycleSnapshot: text("billing_cycle_snapshot").notNull(),
  standardFeePaiseSnapshot: bigint("standard_fee_paise_snapshot", { mode: "number" }).notNull(),
  agreedFeePaiseSnapshot: bigint("agreed_fee_paise_snapshot", { mode: "number" }).notNull(),
  createdByUserId: uuid("created_by_user_id").notNull(),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  cancellationReason: text("cancellation_reason").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("client_package_assignments_tenant_id_unique").on(table.tenantId, table.id),
  foreignKey({ name: "client_package_assignments_entity_tenant_fk", columns: [table.tenantId, table.legalEntityId], foreignColumns: [legalEntities.tenantId, legalEntities.id] }),
  foreignKey({ name: "client_package_assignments_package_tenant_fk", columns: [table.tenantId, table.packageId], foreignColumns: [servicePackages.tenantId, servicePackages.id] }),
  foreignKey({ name: "client_package_assignments_creator_membership_fk", columns: [table.tenantId, table.createdByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("client_package_assignments_entity_dates_idx").on(table.tenantId, table.legalEntityId, table.effectiveFrom, table.effectiveTo),
  index("client_package_assignments_tenant_status_idx").on(table.tenantId, table.status, table.effectiveTo),
  check("client_package_assignments_dates_check", sql`${table.effectiveTo} is null or ${table.effectiveTo} >= ${table.effectiveFrom}`),
  check("client_package_assignments_status_check", sql`${table.status} in ('scheduled', 'active', 'ended', 'cancelled')`),
  check("client_package_assignments_cycle_check", sql`${table.billingCycleSnapshot} in ('monthly', 'quarterly', 'annual', 'one_time')`),
  check("client_package_assignments_fee_check", sql`${table.standardFeePaiseSnapshot} >= 0 and ${table.agreedFeePaiseSnapshot} >= 0`),
  check("client_package_assignments_cancellation_check", sql`(${table.status} = 'cancelled' and ${table.cancelledAt} is not null and length(trim(${table.cancellationReason})) > 0) or (${table.status} <> 'cancelled' and ${table.cancelledAt} is null and ${table.cancellationReason} = '')`),
]);

export const clientPackageAssignmentServices = pgTable("client_package_assignment_services", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  assignmentId: uuid("assignment_id").notNull(),
  serviceId: uuid("service_id").notNull(),
  serviceCodeSnapshot: text("service_code_snapshot").notNull(),
  serviceNameSnapshot: text("service_name_snapshot").notNull(),
  serviceCategorySnapshot: text("service_category_snapshot").notNull(),
  source: text("source").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("client_package_assignment_services_assignment_service_unique").on(table.tenantId, table.assignmentId, table.serviceId),
  foreignKey({ name: "client_package_assignment_services_assignment_tenant_fk", columns: [table.tenantId, table.assignmentId], foreignColumns: [clientPackageAssignments.tenantId, clientPackageAssignments.id] }),
  foreignKey({ name: "client_package_assignment_services_service_tenant_fk", columns: [table.tenantId, table.serviceId], foreignColumns: [serviceCatalog.tenantId, serviceCatalog.id] }),
  index("client_package_assignment_services_assignment_idx").on(table.tenantId, table.assignmentId),
  check("client_package_assignment_services_source_check", sql`${table.source} in ('package', 'addon')`),
]);

export const registrations = pgTable("registrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  legalEntityId: uuid("legal_entity_id").notNull(),
  registrationType: text("registration_type").notNull(),
  registrationKey: text("registration_key").notNull(),
  status: text("status").notNull().default("active"),
}, (table) => [
  unique("registrations_tenant_entity_key_unique").on(table.tenantId, table.legalEntityId, table.registrationKey),
  foreignKey({ name: "registrations_entity_tenant_fk", columns: [table.tenantId, table.legalEntityId], foreignColumns: [legalEntities.tenantId, legalEntities.id] }),
  index("registrations_tenant_idx").on(table.tenantId),
  check("registrations_status_check", sql`${table.status} in ('active', 'inactive')`),
]);

export const complianceSchedules = pgTable("compliance_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  serviceCode: text("service_code").notNull(),
  frequency: text("frequency").notNull(),
  dueMonthOffset: integer("due_month_offset").notNull().default(1),
  dueDay: integer("due_day").notNull(),
  internalLeadDays: integer("internal_lead_days").notNull().default(3),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("compliance_schedules_tenant_id_unique").on(table.tenantId, table.id),
  uniqueIndex("compliance_schedules_tenant_service_effective_unique").on(table.tenantId, sql`lower(${table.serviceCode})`, table.effectiveFrom),
  index("compliance_schedules_tenant_status_idx").on(table.tenantId, table.status, table.effectiveFrom),
  check("compliance_schedules_service_code_check", sql`${table.serviceCode} ~ '^[A-Z0-9][A-Z0-9_-]{1,19}$'`),
  check("compliance_schedules_frequency_check", sql`${table.frequency} in ('monthly', 'quarterly', 'annual')`),
  check("compliance_schedules_due_day_check", sql`${table.dueDay} between 1 and 31`),
  check("compliance_schedules_due_month_offset_check", sql`${table.dueMonthOffset} between 0 and 12`),
  check("compliance_schedules_internal_lead_check", sql`${table.internalLeadDays} between 0 and 60`),
  check("compliance_schedules_status_check", sql`${table.status} in ('active', 'archived')`),
]);

/**
 * One client's departure from the firm's calendar.
 *
 * The firm schedule says GSTR-1 is monthly, due on the 11th, and that was the
 * whole model: every entitled client got the same period arithmetic. A client
 * on QRMP files quarterly, a government deductor pays on a different day, and a
 * client who dropped a service mid-year should stop appearing — none of which
 * could be said, so all three were handled by somebody remembering.
 *
 * Effective-dated because a client moving to QRMP on 1 April has monthly
 * periods behind them and quarterly ones ahead, and rewriting the past to match
 * today's cadence would misstate what was actually due.
 */
export const clientComplianceSchedules = pgTable("client_compliance_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  legalEntityId: uuid("legal_entity_id").notNull(),
  /** A code from `service_catalog`, upper-case as the catalogue stores it. */
  serviceCode: text("service_code").notNull(),
  /** `override` carries a full rule; `exempt` raises nothing at all. */
  mode: text("mode").notNull().default("override"),
  frequency: text("frequency"),
  dueMonthOffset: integer("due_month_offset"),
  dueDay: integer("due_day"),
  internalLeadDays: integer("internal_lead_days"),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  /** Why this client differs. "QRMP from Q1" is worth more than the dates. */
  note: text("note").notNull().default(""),
  createdByUserId: uuid("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("client_compliance_schedules_tenant_id_unique").on(table.tenantId, table.id),
  uniqueIndex("client_compliance_schedules_entity_service_effective_unique")
    .on(table.tenantId, table.legalEntityId, sql`lower(${table.serviceCode})`, table.effectiveFrom),
  foreignKey({ name: "client_compliance_schedules_entity_tenant_fk", columns: [table.tenantId, table.legalEntityId], foreignColumns: [legalEntities.tenantId, legalEntities.id] }),
  foreignKey({ name: "client_compliance_schedules_creator_membership_fk", columns: [table.tenantId, table.createdByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("client_compliance_schedules_lookup_idx").on(table.tenantId, table.serviceCode, table.effectiveFrom),
  check("client_compliance_schedules_service_code_check", sql`${table.serviceCode} ~ '^[A-Z0-9][A-Z0-9_-]{1,19}$'`),
  check("client_compliance_schedules_mode_check", sql`${table.mode} in ('override', 'exempt')`),
  // An override carries a whole rule and an exemption carries none. A half-filled
  // override would silently fall back to the firm for the missing half, which is
  // the ambiguity this table exists to remove.
  check("client_compliance_schedules_rule_pair_check", sql`
    (${table.mode} = 'override'
      and ${table.frequency} is not null and ${table.dueMonthOffset} is not null
      and ${table.dueDay} is not null and ${table.internalLeadDays} is not null)
    or (${table.mode} = 'exempt'
      and ${table.frequency} is null and ${table.dueMonthOffset} is null
      and ${table.dueDay} is null and ${table.internalLeadDays} is null)
  `),
  check("client_compliance_schedules_frequency_check", sql`${table.frequency} is null or ${table.frequency} in ('monthly', 'quarterly', 'annual')`),
  check("client_compliance_schedules_due_day_check", sql`${table.dueDay} is null or ${table.dueDay} between 1 and 31`),
  check("client_compliance_schedules_due_month_offset_check", sql`${table.dueMonthOffset} is null or ${table.dueMonthOffset} between 0 and 12`),
  check("client_compliance_schedules_internal_lead_check", sql`${table.internalLeadDays} is null or ${table.internalLeadDays} between 0 and 60`),
  check("client_compliance_schedules_note_check", sql`length(${table.note}) <= 500`),
]);

/**
 * A statutory date moved by the authority that set it.
 *
 * An extension is not a per-client edit; it comes from one notification and
 * applies to everybody filing that return for that period. Recorded once, with
 * the notification it came from, so the reason is attached to the effect and a
 * client cannot be quietly left on the old date because nobody got to them.
 *
 * `legal_entity_id` null is the ordinary case — the whole class. A named client
 * covers the narrower kind: a specific extension granted on application.
 */
export const complianceExtensions = pgTable("compliance_extensions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  serviceCode: text("service_code").notNull(),
  /** The period label the generator produces, e.g. `FY 2025–26`. */
  periodKey: text("period_key").notNull(),
  /** Null means every client filing this service for this period. */
  legalEntityId: uuid("legal_entity_id"),
  originalDueDate: date("original_due_date", { mode: "string" }).notNull(),
  extendedDueDate: date("extended_due_date", { mode: "string" }).notNull(),
  /** "CBIC Notification 12/2026". An extension nobody can cite is a rumour. */
  authority: text("authority").notNull(),
  note: text("note").notNull().default(""),
  createdByUserId: uuid("created_by_user_id").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  /** How many open obligations this actually moved, for the record. */
  appliedCount: integer("applied_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("compliance_extensions_tenant_id_unique").on(table.tenantId, table.id),
  // One class-wide extension per service and period, and one per named client.
  uniqueIndex("compliance_extensions_class_unique")
    .on(table.tenantId, sql`lower(${table.serviceCode})`, table.periodKey)
    .where(sql`${table.legalEntityId} is null`),
  uniqueIndex("compliance_extensions_client_unique")
    .on(table.tenantId, sql`lower(${table.serviceCode})`, table.periodKey, table.legalEntityId)
    .where(sql`${table.legalEntityId} is not null`),
  foreignKey({ name: "compliance_extensions_entity_tenant_fk", columns: [table.tenantId, table.legalEntityId], foreignColumns: [legalEntities.tenantId, legalEntities.id] }),
  foreignKey({ name: "compliance_extensions_creator_membership_fk", columns: [table.tenantId, table.createdByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("compliance_extensions_lookup_idx").on(table.tenantId, table.serviceCode, table.periodKey),
  check("compliance_extensions_service_code_check", sql`${table.serviceCode} ~ '^[A-Z0-9][A-Z0-9_-]{1,19}$'`),
  check("compliance_extensions_period_check", sql`length(trim(${table.periodKey})) between 2 and 60`),
  // A date moved earlier is not an extension. Whatever that is, it needs its own
  // name and its own conversation with the client.
  check("compliance_extensions_direction_check", sql`${table.extendedDueDate} > ${table.originalDueDate}`),
  check("compliance_extensions_authority_check", sql`length(trim(${table.authority})) between 2 and 200`),
  check("compliance_extensions_note_check", sql`length(${table.note}) <= 500`),
  check("compliance_extensions_applied_count_check", sql`${table.appliedCount} >= 0`),
]);

/**
 * A version of the procedure the firm follows for one service.
 *
 * Versioned rather than mutable because the project's own non-negotiable says
 * historic rules are versioned, and because a procedure revised in October must
 * not silently change what September's filing was measured against. A work item
 * snapshots the version it was raised under; nothing here is read live.
 */
export const procedureVersions = pgTable("procedure_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  /** A code from `service_catalog`, upper-case as the catalogue stores it. */
  serviceCode: text("service_code").notNull(),
  version: integer("version").notNull(),
  status: text("status").notNull().default("draft"),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  note: text("note").notNull().default(""),
  publishedByUserId: uuid("published_by_user_id"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("procedure_versions_tenant_id_unique").on(table.tenantId, table.id),
  unique("procedure_versions_service_version_unique").on(table.tenantId, table.serviceCode, table.version),
  foreignKey({ name: "procedure_versions_creator_membership_fk", columns: [table.tenantId, table.createdByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "procedure_versions_publisher_membership_fk", columns: [table.tenantId, table.publishedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("procedure_versions_lookup_idx").on(table.tenantId, table.serviceCode, table.status, table.effectiveFrom),
  check("procedure_versions_service_check", sql`${table.serviceCode} ~ '^[A-Z0-9][A-Z0-9_-]{1,19}$'`),
  check("procedure_versions_status_check", sql`${table.status} in ('draft', 'published', 'archived')`),
  check("procedure_versions_version_check", sql`${table.version} > 0`),
  // A published procedure has to say who put their name to it and when.
  check("procedure_versions_published_state_check", sql`${table.status} = 'draft' or (${table.publishedAt} is not null and ${table.publishedByUserId} is not null)`),
  check("procedure_versions_note_check", sql`length(${table.note}) <= 500`),
]);

/** One step of a procedure, in the order the firm performs them. */
export const procedureSteps = pgTable("procedure_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  procedureVersionId: uuid("procedure_version_id").notNull(),
  position: integer("position").notNull(),
  title: text("title").notNull(),
  instruction: text("instruction").notNull().default(""),
  mandatory: boolean("mandatory").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("procedure_steps_tenant_id_unique").on(table.tenantId, table.id),
  unique("procedure_steps_version_position_unique").on(table.tenantId, table.procedureVersionId, table.position),
  foreignKey({ name: "procedure_steps_version_tenant_fk", columns: [table.tenantId, table.procedureVersionId], foreignColumns: [procedureVersions.tenantId, procedureVersions.id] }),
  index("procedure_steps_version_idx").on(table.tenantId, table.procedureVersionId, table.position),
  check("procedure_steps_position_check", sql`${table.position} between 1 and 200`),
  check("procedure_steps_title_check", sql`length(trim(${table.title})) between 2 and 200`),
  check("procedure_steps_instruction_check", sql`length(${table.instruction}) <= 1000`),
]);

export const workItems = pgTable("work_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  legalEntityId: uuid("legal_entity_id").notNull(),
  serviceKey: text("service_key").notNull(),
  periodKey: text("period_key").notNull(),
  status: text("status").notNull(),
  statutoryDueDate: date("statutory_due_date", { mode: "string" }).notNull(),
  internalDueDate: date("internal_due_date", { mode: "string" }),
  assigneeId: uuid("assignee_id"),
  reviewerId: uuid("reviewer_id"),
  blockerNote: text("blocker_note").notNull().default(""),
  progress: integer("progress").notNull().default(0),
  missingItemCount: integer("missing_item_count").notNull().default(0),
  // Snapshot of the service standard as it stood when the obligation was
  // raised. Null means the firm has not estimated this work.
  budgetMinutes: integer("budget_minutes"),
  /**
   * The statutory date this obligation carried before an extension moved it.
   * Null where nothing moved. Kept so "extended from 31 Dec" stays visible and
   * a late filing is still measured against something honest.
   */
  originalStatutoryDueDate: date("original_statutory_due_date", { mode: "string" }),
  /**
   * The procedure version instantiated onto this item. Null for work raised for
   * a service the firm has not written a procedure for, which keeps the
   * hand-typed progress it has always had.
   */
  procedureVersionId: uuid("procedure_version_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("work_items_tenant_entity_service_period_unique").on(table.tenantId, table.legalEntityId, table.serviceKey, table.periodKey),
  unique("work_items_tenant_id_unique").on(table.tenantId, table.id),
  unique("work_items_tenant_id_entity_unique").on(table.tenantId, table.id, table.legalEntityId),
  foreignKey({ name: "work_items_entity_tenant_fk", columns: [table.tenantId, table.legalEntityId], foreignColumns: [legalEntities.tenantId, legalEntities.id] }),
  foreignKey({ name: "work_items_assignee_membership_fk", columns: [table.tenantId, table.assigneeId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "work_items_reviewer_membership_fk", columns: [table.tenantId, table.reviewerId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("work_items_attention_idx").on(table.tenantId, table.status, table.statutoryDueDate),
  index("work_items_tenant_due_idx").on(table.tenantId, table.statutoryDueDate),
  index("work_items_assignee_due_idx").on(table.tenantId, table.assigneeId, table.status, table.internalDueDate),
  index("work_items_reviewer_idx").on(table.tenantId, table.reviewerId, table.status),
  check("work_items_status_check", sql`${table.status} in ('critical', 'at_risk', 'waiting', 'review', 'completed')`),
  check("work_items_progress_check", sql`${table.progress} between 0 and 100`),
  check("work_items_missing_count_check", sql`${table.missingItemCount} >= 0`),
  check("work_items_budget_minutes_check", sql`${table.budgetMinutes} is null or ${table.budgetMinutes} between 1 and 100000`),
  check("work_items_deadline_order_check", sql`${table.internalDueDate} is null or ${table.internalDueDate} <= ${table.statutoryDueDate}`),
  check("work_items_separation_check", sql`${table.assigneeId} is null or ${table.reviewerId} is null or ${table.assigneeId} <> ${table.reviewerId}`),
  check("work_items_completed_state_check", sql`${table.status} <> 'completed' or (${table.progress} = 100 and ${table.missingItemCount} = 0)`),
]);

/**
 * The procedure as it stands on one work item.
 *
 * Copied from the published version at the moment the obligation is raised, not
 * referenced. A firm that improves its GST procedure in October has not changed
 * what it did in September, and the record has to be able to say what was
 * actually followed.
 *
 * `not_applicable` needs a reason. A step skipped without one is
 * indistinguishable from a step forgotten, which is the thing this exists to
 * prevent.
 */
export const workItemSteps = pgTable("work_item_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  workItemId: uuid("work_item_id").notNull(),
  procedureVersionId: uuid("procedure_version_id").notNull(),
  position: integer("position").notNull(),
  title: text("title").notNull(),
  instruction: text("instruction").notNull().default(""),
  mandatory: boolean("mandatory").notNull().default(true),
  status: text("status").notNull().default("pending"),
  note: text("note").notNull().default(""),
  completedByUserId: uuid("completed_by_user_id"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("work_item_steps_tenant_id_unique").on(table.tenantId, table.id),
  unique("work_item_steps_item_position_unique").on(table.tenantId, table.workItemId, table.position),
  foreignKey({ name: "work_item_steps_item_tenant_fk", columns: [table.tenantId, table.workItemId], foreignColumns: [workItems.tenantId, workItems.id] }),
  foreignKey({ name: "work_item_steps_completer_membership_fk", columns: [table.tenantId, table.completedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("work_item_steps_item_idx").on(table.tenantId, table.workItemId, table.position),
  check("work_item_steps_position_check", sql`${table.position} between 1 and 200`),
  check("work_item_steps_status_check", sql`${table.status} in ('pending', 'done', 'not_applicable')`),
  check("work_item_steps_title_check", sql`length(trim(${table.title})) between 2 and 200`),
  check("work_item_steps_text_check", sql`length(${table.instruction}) <= 1000 and length(${table.note}) <= 1000`),
  // A step that is done says who did it and when; a pending one has neither.
  check("work_item_steps_done_state_check", sql`(${table.status} = 'pending' and ${table.completedByUserId} is null and ${table.completedAt} is null) or (${table.status} <> 'pending' and ${table.completedByUserId} is not null and ${table.completedAt} is not null)`),
  // Skipping a step is a decision somebody has to own in words.
  check("work_item_steps_not_applicable_check", sql`${table.status} <> 'not_applicable' or length(trim(${table.note})) > 0`),
]);

/**
 * One round of review on one obligation.
 *
 * Review was a status somebody could set from a dropdown: it recorded that work
 * had reached a reviewer, and nothing about whether they looked at it, what they
 * decided, or why. A round is the decision — opened by a submission, closed by
 * an approval or a return, both stamped with a person and a time.
 *
 * Returned work reopens and the next submission is the next round, so "how many
 * times did this come back" is a question the record can answer.
 */
export const workReviewRounds = pgTable("work_review_rounds", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  workItemId: uuid("work_item_id").notNull(),
  round: integer("round").notNull(),
  /** The reviewer named when the work was submitted, not whoever holds the field now. */
  reviewerUserId: uuid("reviewer_user_id").notNull(),
  submittedByUserId: uuid("submitted_by_user_id").notNull(),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  submissionNote: text("submission_note").notNull().default(""),
  /** The workflow state to put the item back into if the round is returned. */
  statusBeforeReview: text("status_before_review").notNull(),
  outcome: text("outcome"),
  decidedByUserId: uuid("decided_by_user_id"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("work_review_rounds_tenant_id_unique").on(table.tenantId, table.id),
  unique("work_review_rounds_item_round_unique").on(table.tenantId, table.workItemId, table.round),
  // One round open at a time. Two would make "the current round" meaningless.
  uniqueIndex("work_review_rounds_open_unique").on(table.tenantId, table.workItemId).where(sql`${table.outcome} is null`),
  foreignKey({ name: "work_review_rounds_item_tenant_fk", columns: [table.tenantId, table.workItemId], foreignColumns: [workItems.tenantId, workItems.id] }),
  foreignKey({ name: "work_review_rounds_reviewer_membership_fk", columns: [table.tenantId, table.reviewerUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "work_review_rounds_submitter_membership_fk", columns: [table.tenantId, table.submittedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "work_review_rounds_decider_membership_fk", columns: [table.tenantId, table.decidedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("work_review_rounds_item_idx").on(table.tenantId, table.workItemId, table.round),
  index("work_review_rounds_reviewer_idx").on(table.tenantId, table.reviewerUserId, table.outcome),
  check("work_review_rounds_round_check", sql`${table.round} > 0`),
  check("work_review_rounds_outcome_check", sql`${table.outcome} is null or ${table.outcome} in ('approved', 'returned')`),
  check("work_review_rounds_status_check", sql`${table.statusBeforeReview} in ('critical', 'at_risk', 'waiting', 'review')`),
  // A decided round says who decided and when; an open one has neither.
  check("work_review_rounds_decided_state_check", sql`(${table.outcome} is null and ${table.decidedByUserId} is null and ${table.decidedAt} is null) or (${table.outcome} is not null and ${table.decidedByUserId} is not null and ${table.decidedAt} is not null)`),
  // Work sent back without a reason tells the preparer nothing.
  check("work_review_rounds_returned_reason_check", sql`${table.outcome} <> 'returned' or length(trim(${table.decisionNote})) > 0`),
  // Nobody signs off their own submission. This is the control, not the status.
  check("work_review_rounds_self_review_check", sql`${table.decidedByUserId} is null or ${table.decidedByUserId} <> ${table.submittedByUserId}`),
  check("work_review_rounds_text_check", sql`length(${table.submissionNote}) <= 2000 and length(${table.decisionNote}) <= 2000`),
]);

/**
 * What a piece of work is actually waiting on.
 *
 * `waiting` was a status with a 500-character note beside it. The note said
 * "bank statement awaited" and nothing in the system knew which statement, who
 * owed it, when it was due, or that it had arrived three weeks ago — so work sat
 * in `waiting` long after the wait had ended, and the only way to find out was
 * to ask the person.
 *
 * A dependency names the thing. Two of the three kinds close themselves: a
 * client deliverable clears when its document request is received, and a
 * predecessor clears when that work completes. Only a genuinely external wait
 * needs a person to say it arrived.
 */
export const workDependencies = pgTable("work_dependencies", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  /** The work that is waiting. */
  workItemId: uuid("work_item_id").notNull(),
  kind: text("kind").notNull(),
  /** What is awaited, in the words somebody would use asking for it. */
  title: text("title").notNull(),
  /** Set for `client_request`: the deliverable already being chased. */
  documentRequestId: uuid("document_request_id"),
  /** Set for `work_item`: the obligation that must finish first. */
  dependsOnWorkItemId: uuid("depends_on_work_item_id"),
  /** Set for `external`: a bank, a portal, a previous auditor. */
  externalParty: text("external_party"),
  /** When the firm expects it. A wait with no date is not a plan. */
  expectedOn: date("expected_on", { mode: "string" }).notNull(),
  raisedByUserId: uuid("raised_by_user_id").notNull(),
  clearedAt: timestamp("cleared_at", { withTimezone: true }),
  clearedByUserId: uuid("cleared_by_user_id"),
  clearanceNote: text("clearance_note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("work_dependencies_tenant_id_unique").on(table.tenantId, table.id),
  foreignKey({ name: "work_dependencies_work_tenant_fk", columns: [table.tenantId, table.workItemId], foreignColumns: [workItems.tenantId, workItems.id] }),
  foreignKey({ name: "work_dependencies_request_tenant_fk", columns: [table.tenantId, table.documentRequestId], foreignColumns: [documentRequests.tenantId, documentRequests.id] }),
  foreignKey({ name: "work_dependencies_predecessor_tenant_fk", columns: [table.tenantId, table.dependsOnWorkItemId], foreignColumns: [workItems.tenantId, workItems.id] }),
  foreignKey({ name: "work_dependencies_raiser_membership_fk", columns: [table.tenantId, table.raisedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "work_dependencies_clearer_membership_fk", columns: [table.tenantId, table.clearedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("work_dependencies_open_idx").on(table.tenantId, table.workItemId, table.clearedAt),
  index("work_dependencies_expected_idx").on(table.tenantId, table.expectedOn, table.clearedAt),
  // The two self-closing kinds are looked up by their target when it arrives.
  index("work_dependencies_request_idx").on(table.tenantId, table.documentRequestId),
  index("work_dependencies_predecessor_idx").on(table.tenantId, table.dependsOnWorkItemId),
  check("work_dependencies_kind_check", sql`${table.kind} in ('client_request', 'work_item', 'external')`),
  // Each kind carries exactly its own target and no other. A `client_request`
  // row with a null request would be prose again, wearing a type.
  check("work_dependencies_target_check", sql`
    (${table.kind} = 'client_request' and ${table.documentRequestId} is not null and ${table.dependsOnWorkItemId} is null and ${table.externalParty} is null)
    or (${table.kind} = 'work_item' and ${table.dependsOnWorkItemId} is not null and ${table.documentRequestId} is null and ${table.externalParty} is null)
    or (${table.kind} = 'external' and ${table.externalParty} is not null and ${table.documentRequestId} is null and ${table.dependsOnWorkItemId} is null)
  `),
  // Nothing waits on itself. A one-step cycle is the easy half; the repository
  // walks the chain for the rest.
  check("work_dependencies_self_check", sql`${table.dependsOnWorkItemId} is null or ${table.dependsOnWorkItemId} <> ${table.workItemId}`),
  check("work_dependencies_cleared_pair_check", sql`(${table.clearedAt} is null and ${table.clearedByUserId} is null) or (${table.clearedAt} is not null and ${table.clearedByUserId} is not null)`),
  check("work_dependencies_title_check", sql`length(trim(${table.title})) between 3 and 200`),
  check("work_dependencies_party_check", sql`${table.externalParty} is null or length(trim(${table.externalParty})) between 2 and 120`),
  check("work_dependencies_note_check", sql`length(${table.clearanceNote}) <= 500`),
]);

/**
 * The rungs a late obligation climbs.
 *
 * Two notifications existed, `work_item_due` and `work_item_overdue`, and both
 * went to the assignee. So the only person told a deadline was slipping was the
 * person it was already slipping past, and nothing reached anybody who could do
 * something about it until somebody happened to look at a queue.
 *
 * A rung is a date and an audience: how far from which deadline, and who hears.
 * The firm names the audience by role rather than by reporting line, so nobody
 * is missed for want of a manager on their profile.
 */
export const escalationRules = pgTable("escalation_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  /** 1 is the first rung. Higher rungs are further up and later. */
  rung: integer("rung").notNull(),
  /** Which deadline the offset is measured from. */
  anchor: text("anchor").notNull(),
  /** Negative is before the anchor, 0 is the day itself, positive is after. */
  offsetDays: integer("offset_days").notNull(),
  /** `assignee` is whoever holds it; `role` is everybody carrying that role. */
  targetKind: text("target_kind").notNull(),
  targetRole: text("target_role"),
  /** What this rung means, in the words the notification will use. */
  label: text("label").notNull(),
  status: text("status").notNull().default("active"),
  createdByUserId: uuid("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("escalation_rules_tenant_id_unique").on(table.tenantId, table.id),
  // One rule per rung while it is live. A ladder with two rung 2s has no order.
  uniqueIndex("escalation_rules_tenant_rung_unique")
    .on(table.tenantId, table.rung)
    .where(sql`${table.status} = 'active'`),
  foreignKey({ name: "escalation_rules_creator_membership_fk", columns: [table.tenantId, table.createdByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("escalation_rules_active_idx").on(table.tenantId, table.status, table.rung),
  check("escalation_rules_rung_check", sql`${table.rung} between 1 and 20`),
  check("escalation_rules_anchor_check", sql`${table.anchor} in ('internal_due', 'statutory_due')`),
  check("escalation_rules_offset_check", sql`${table.offsetDays} between -60 and 60`),
  check("escalation_rules_target_kind_check", sql`${table.targetKind} in ('assignee', 'role')`),
  // A role rung needs a role and an assignee rung must not carry one, so the
  // audience of a rung is never open to interpretation.
  check("escalation_rules_target_pair_check", sql`
    (${table.targetKind} = 'role' and ${table.targetRole} is not null)
    or (${table.targetKind} = 'assignee' and ${table.targetRole} is null)
  `),
  check("escalation_rules_role_value_check", sql`${table.targetRole} is null or ${table.targetRole} in ('firm_administrator', 'partner', 'manager', 'associate')`),
  check("escalation_rules_label_check", sql`length(trim(${table.label})) between 3 and 120`),
  check("escalation_rules_status_check", sql`${table.status} in ('active', 'archived')`),
]);

/**
 * That an obligation climbed a rung, and who heard.
 *
 * One row per rung per obligation, ever: a ladder climbs, it does not climb the
 * same rung twice. The recipients are written down as text rather than joined
 * live, because who carried a role in December is the fact this record is
 * making, and people change roles.
 */
export const workEscalations = pgTable("work_escalations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  workItemId: uuid("work_item_id").notNull(),
  rung: integer("rung").notNull(),
  /** Null where the rule has since been removed; the rung still happened. */
  ruleId: uuid("rule_id"),
  /** Snapshot of the rule's label, so a later edit does not rewrite history. */
  reason: text("reason").notNull(),
  /** The date key it fired on, in the firm's timezone. */
  firedOn: date("fired_on", { mode: "string" }).notNull(),
  /** Zero means the rung was passed without telling anybody — see the summary. */
  notifiedCount: integer("notified_count").notNull().default(0),
  /** Who was told, named. Or why nobody was. */
  recipientSummary: text("recipient_summary").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("work_escalations_tenant_id_unique").on(table.tenantId, table.id),
  unique("work_escalations_item_rung_unique").on(table.tenantId, table.workItemId, table.rung),
  foreignKey({ name: "work_escalations_work_tenant_fk", columns: [table.tenantId, table.workItemId], foreignColumns: [workItems.tenantId, workItems.id] }),
  foreignKey({ name: "work_escalations_rule_tenant_fk", columns: [table.tenantId, table.ruleId], foreignColumns: [escalationRules.tenantId, escalationRules.id] }),
  index("work_escalations_item_idx").on(table.tenantId, table.workItemId, table.rung),
  index("work_escalations_fired_idx").on(table.tenantId, table.firedOn),
  check("work_escalations_rung_check", sql`${table.rung} between 1 and 20`),
  check("work_escalations_notified_check", sql`${table.notifiedCount} >= 0`),
  check("work_escalations_reason_check", sql`length(trim(${table.reason})) between 3 and 120`),
  check("work_escalations_summary_check", sql`length(${table.recipientSummary}) <= 500`),
]);

export const officeTasks = pgTable("office_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  assigneeId: uuid("assignee_id").notNull(),
  reviewerId: uuid("reviewer_id"),
  assignedByUserId: uuid("assigned_by_user_id").notNull(),
  priority: text("priority").notNull().default("normal"),
  status: text("status").notNull().default("todo"),
  dueDate: date("due_date", { mode: "string" }).notNull(),
  blockerNote: text("blocker_note").notNull().default(""),
  legalEntityId: uuid("legal_entity_id"),
  workItemId: uuid("work_item_id"),
  // Typed per task: office tasks are not catalogue-driven, so there is no
  // service standard to inherit. Null means the task is unestimated.
  estimateMinutes: integer("estimate_minutes"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("office_tasks_tenant_id_unique").on(table.tenantId, table.id),
  foreignKey({ name: "office_tasks_assignee_membership_fk", columns: [table.tenantId, table.assigneeId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "office_tasks_reviewer_membership_fk", columns: [table.tenantId, table.reviewerId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "office_tasks_assigner_membership_fk", columns: [table.tenantId, table.assignedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "office_tasks_entity_tenant_fk", columns: [table.tenantId, table.legalEntityId], foreignColumns: [legalEntities.tenantId, legalEntities.id] }),
  foreignKey({ name: "office_tasks_work_entity_tenant_fk", columns: [table.tenantId, table.workItemId, table.legalEntityId], foreignColumns: [workItems.tenantId, workItems.id, workItems.legalEntityId] }),
  index("office_tasks_assignee_status_due_idx").on(table.tenantId, table.assigneeId, table.status, table.dueDate),
  index("office_tasks_status_due_idx").on(table.tenantId, table.status, table.dueDate),
  index("office_tasks_reviewer_idx").on(table.tenantId, table.reviewerId, table.status),
  index("office_tasks_assigner_idx").on(table.tenantId, table.assignedByUserId, table.status),
  check("office_tasks_priority_check", sql`${table.priority} in ('low', 'normal', 'high', 'urgent')`),
  check("office_tasks_status_check", sql`${table.status} in ('todo', 'in_progress', 'waiting', 'review', 'completed', 'cancelled')`),
  check("office_tasks_reviewer_separation_check", sql`${table.reviewerId} is null or ${table.reviewerId} <> ${table.assigneeId}`),
  check("office_tasks_waiting_note_check", sql`${table.status} <> 'waiting' or length(trim(${table.blockerNote})) > 0`),
  check("office_tasks_work_client_check", sql`${table.workItemId} is null or ${table.legalEntityId} is not null`),
  check("office_tasks_estimate_minutes_check", sql`${table.estimateMinutes} is null or ${table.estimateMinutes} between 1 and 100000`),
  check("office_tasks_completed_state_check", sql`(${table.status} = 'completed' and ${table.completedAt} is not null) or (${table.status} <> 'completed' and ${table.completedAt} is null)`),
]);

export const personalTodos = pgTable("personal_todos", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  ownerUserId: uuid("owner_user_id").notNull(),
  title: text("title").notNull(),
  notes: text("notes").notNull().default(""),
  dueDate: date("due_date", { mode: "string" }),
  dueTime: text("due_time"),
  priority: text("priority").notNull().default("normal"),
  category: text("category").notNull().default(""),
  status: text("status").notNull().default("open"),
  // Completing an instance schedules the next one. Null means it does not repeat.
  recurrenceRule: text("recurrence_rule"),
  recurrenceInterval: integer("recurrence_interval"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: "personal_todos_owner_membership_fk", columns: [table.tenantId, table.ownerUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("personal_todos_owner_status_due_idx").on(table.tenantId, table.ownerUserId, table.status, table.dueDate),
  index("personal_todos_owner_updated_idx").on(table.tenantId, table.ownerUserId, table.updatedAt),
  check("personal_todos_title_check", sql`length(trim(${table.title})) between 1 and 160`),
  check("personal_todos_notes_check", sql`length(${table.notes}) <= 2000`),
  check("personal_todos_category_check", sql`length(${table.category}) <= 40`),
  check("personal_todos_due_time_check", sql`${table.dueTime} is null or ${table.dueTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
  check("personal_todos_priority_check", sql`${table.priority} in ('low', 'normal', 'high', 'urgent')`),
  check("personal_todos_status_check", sql`${table.status} in ('open', 'completed', 'archived')`),
  check("personal_todos_completed_state_check", sql`(${table.status} = 'completed' and ${table.completedAt} is not null) or (${table.status} <> 'completed' and ${table.completedAt} is null)`),
  check("personal_todos_archived_state_check", sql`(${table.status} = 'archived' and ${table.archivedAt} is not null) or (${table.status} <> 'archived' and ${table.archivedAt} is null)`),
  check("personal_todos_recurrence_rule_check", sql`${table.recurrenceRule} is null or ${table.recurrenceRule} in ('day', 'week', 'month')`),
  check("personal_todos_recurrence_interval_check", sql`${table.recurrenceInterval} is null or ${table.recurrenceInterval} between 1 and 365`),
  check("personal_todos_recurrence_pair_check", sql`(${table.recurrenceRule} is null) = (${table.recurrenceInterval} is null)`),
  // A repeat with no due date has no next instance to compute.
  check("personal_todos_recurrence_due_check", sql`${table.recurrenceRule} is null or ${table.dueDate} is not null`),
]);

/**
 * Attendance master data. Leave types, holidays, and shifts were previously fixed
 * in code or in the single firm-wide policy; these let each firm define its own
 * and are consumed by the attendance workspace.
 */
/**
 * The ICAI figures an articleship register runs on, held by the firm.
 *
 * Deliberately not written into the application. ICAI revises the practical
 * training period and the stipend slabs by notification, and a wrong number
 * baked into a compliance register is worse than an empty field — it is wrong
 * silently. `confirmed` stays false until somebody has checked these against the
 * current notification, and the register says so until they have.
 */
/**
 * The CPE hours a member has to complete, held by the firm.
 *
 * Not written into the application, for the same reason the articleship figures
 * are not: ICAI sets these by announcement and revises them, and they differ by
 * whether a member is in practice. `confirmed` stays false until somebody has
 * checked them, and every page that uses them says so until they have.
 */
/**
 * A performance review for one person over one period.
 *
 * The firm already held everything an honest appraisal needs — utilisation
 * against target, capability, training, attendance, what was delivered and what
 * ran late — and none of it reached the conversation. So the evidence is
 * gathered rather than typed, and the judgement is recorded beside it with an
 * author.
 *
 * `evidenceSnapshot` freezes that pack when the review is shared. A draft reads
 * the numbers live; once an employee has been shown a review, the figures behind
 * it must not quietly move underneath them.
 */
export const performanceReviews = pgTable("performance_reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  employeeUserId: uuid("employee_user_id").notNull(),
  reviewerUserId: uuid("reviewer_user_id").notNull(),
  periodFrom: date("period_from", { mode: "string" }).notNull(),
  periodTo: date("period_to", { mode: "string" }).notNull(),
  status: text("status").notNull().default("draft"),
  overallRating: text("overall_rating"),
  strengths: text("strengths").notNull().default(""),
  development: text("development").notNull().default(""),
  evidenceSnapshot: text("evidence_snapshot"),
  sharedAt: timestamp("shared_at", { withTimezone: true }),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("performance_reviews_tenant_id_unique").on(table.tenantId, table.id),
  unique("performance_reviews_period_unique").on(table.tenantId, table.employeeUserId, table.periodFrom, table.periodTo),
  foreignKey({ name: "performance_reviews_employee_membership_fk", columns: [table.tenantId, table.employeeUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "performance_reviews_reviewer_membership_fk", columns: [table.tenantId, table.reviewerUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "performance_reviews_creator_membership_fk", columns: [table.tenantId, table.createdByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("performance_reviews_employee_idx").on(table.tenantId, table.employeeUserId, table.periodTo),
  index("performance_reviews_reviewer_idx").on(table.tenantId, table.reviewerUserId, table.status),
  check("performance_reviews_status_check", sql`${table.status} in ('draft', 'shared', 'acknowledged')`),
  check("performance_reviews_period_check", sql`${table.periodTo} >= ${table.periodFrom}`),
  check("performance_reviews_rating_check", sql`${table.overallRating} is null or ${table.overallRating} in ('below', 'meets', 'exceeds')`),
  // Nobody reviews themselves; that is the whole point of writing it down.
  check("performance_reviews_reviewer_separation_check", sql`${table.reviewerUserId} <> ${table.employeeUserId}`),
  // A review cannot be shown to somebody without a judgement and the evidence
  // it rested on, and cannot be acknowledged before it has been shown.
  check("performance_reviews_shared_state_check", sql`(${table.status} = 'draft' and ${table.sharedAt} is null) or (${table.status} <> 'draft' and ${table.sharedAt} is not null and ${table.overallRating} is not null and ${table.evidenceSnapshot} is not null)`),
  check("performance_reviews_acknowledged_state_check", sql`(${table.status} = 'acknowledged') = (${table.acknowledgedAt} is not null)`),
  check("performance_reviews_text_check", sql`length(${table.strengths}) <= 4000 and length(${table.development}) <= 4000`),
]);

/**
 * One dimension of a review.
 *
 * Rated separately because "below expectations" on its own starts an argument
 * about the word; "below on quality of work, meets on delivery" starts a
 * conversation about the work.
 */
export const performanceReviewRatings = pgTable("performance_review_ratings", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  reviewId: uuid("review_id").notNull(),
  dimension: text("dimension").notNull(),
  rating: text("rating").notNull(),
  note: text("note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("performance_ratings_review_dimension_unique").on(table.tenantId, table.reviewId, table.dimension),
  foreignKey({ name: "performance_ratings_review_tenant_fk", columns: [table.tenantId, table.reviewId], foreignColumns: [performanceReviews.tenantId, performanceReviews.id] }),
  index("performance_ratings_review_idx").on(table.tenantId, table.reviewId),
  check("performance_ratings_dimension_check", sql`${table.dimension} in ('delivery', 'quality', 'capability', 'conduct')`),
  check("performance_ratings_rating_check", sql`${table.rating} in ('below', 'meets', 'exceeds')`),
  check("performance_ratings_note_check", sql`length(${table.note}) <= 2000`),
]);

export const cpePolicies = pgTable("cpe_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  category: text("category").notNull(),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  /** Held in minutes, like every other duration here. CPE is counted in hours. */
  yearlyStructuredMinutes: integer("yearly_structured_minutes").notNull(),
  yearlyTotalMinutes: integer("yearly_total_minutes").notNull(),
  /** The rolling block a member is also measured over, in calendar years. */
  blockYears: integer("block_years").notNull().default(3),
  blockStructuredMinutes: integer("block_structured_minutes").notNull(),
  blockTotalMinutes: integer("block_total_minutes").notNull(),
  confirmed: boolean("confirmed").notNull().default(false),
  note: text("note").notNull().default(""),
  createdByUserId: uuid("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("cpe_policies_tenant_id_unique").on(table.tenantId, table.id),
  unique("cpe_policies_category_effective_unique").on(table.tenantId, table.category, table.effectiveFrom),
  foreignKey({ name: "cpe_policies_creator_membership_fk", columns: [table.tenantId, table.createdByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("cpe_policies_lookup_idx").on(table.tenantId, table.category, table.effectiveFrom),
  check("cpe_policies_category_check", sql`${table.category} in ('in_practice', 'not_in_practice', 'exempt')`),
  check("cpe_policies_block_years_check", sql`${table.blockYears} between 1 and 10`),
  // Structured hours are a subset of the total, so a structured minimum above
  // the total requirement could never be satisfied.
  check("cpe_policies_yearly_check", sql`${table.yearlyStructuredMinutes} between 0 and 120000 and ${table.yearlyTotalMinutes} between 0 and 120000 and ${table.yearlyStructuredMinutes} <= ${table.yearlyTotalMinutes}`),
  check("cpe_policies_block_check", sql`${table.blockStructuredMinutes} between 0 and 600000 and ${table.blockTotalMinutes} between 0 and 600000 and ${table.blockStructuredMinutes} <= ${table.blockTotalMinutes}`),
  check("cpe_policies_note_check", sql`length(${table.note}) <= 500`),
]);

/**
 * Everything anybody in the firm has been trained on.
 *
 * One log for members and non-members alike. Whether an entry counts towards a
 * CPE obligation is decided when the log is read, from the learning type and
 * whether the person is a member — so a course does not have to be filed twice,
 * and an article's orientation training has somewhere to live.
 *
 * `serviceCode` links a session to the firm's service master. It is evidence
 * shown beside a capability rating and never a substitute for one: attending a
 * course is not the same as being judged competent, and a system that conflated
 * them would quietly hand out review rights.
 */
export const trainingRecords = pgTable("training_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  employeeUserId: uuid("employee_user_id").notNull(),
  title: text("title").notNull(),
  provider: text("provider").notNull().default(""),
  learningType: text("learning_type").notNull(),
  completedOn: date("completed_on", { mode: "string" }).notNull(),
  minutes: integer("minutes").notNull(),
  serviceCode: text("service_code").notNull().default(""),
  certificateReference: text("certificate_reference").notNull().default(""),
  note: text("note").notNull().default(""),
  recordedByUserId: uuid("recorded_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("training_records_tenant_id_unique").on(table.tenantId, table.id),
  foreignKey({ name: "training_records_employee_membership_fk", columns: [table.tenantId, table.employeeUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "training_records_recorder_membership_fk", columns: [table.tenantId, table.recordedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("training_records_employee_date_idx").on(table.tenantId, table.employeeUserId, table.completedOn),
  index("training_records_service_idx").on(table.tenantId, table.serviceCode),
  // `course` is training that carries no CPE weight — an article's orientation
  // programme, or an in-house session for staff who are not members.
  check("training_records_type_check", sql`${table.learningType} in ('structured', 'unstructured', 'course')`),
  check("training_records_title_check", sql`length(trim(${table.title})) between 2 and 200`),
  // A whole working month of a single session is a typo, not a course.
  check("training_records_minutes_check", sql`${table.minutes} between 1 and 12000`),
  check("training_records_service_check", sql`${table.serviceCode} = '' or ${table.serviceCode} ~ '^[A-Z0-9][A-Z0-9_-]{1,19}$'`),
  check("training_records_text_check", sql`length(${table.provider}) <= 160 and length(${table.certificateReference}) <= 80 and length(${table.note}) <= 500`),
]);

export const articleshipPolicies = pgTable("articleship_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  trainingMonths: integer("training_months").notNull(),
  /** Leave earned as a fraction of the period actually served, e.g. 1 in 6. */
  leaveFractionNumerator: integer("leave_fraction_numerator").notNull().default(1),
  leaveFractionDenominator: integer("leave_fraction_denominator").notNull().default(6),
  confirmed: boolean("confirmed").notNull().default(false),
  note: text("note").notNull().default(""),
  createdByUserId: uuid("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("articleship_policies_tenant_id_unique").on(table.tenantId, table.id),
  unique("articleship_policies_effective_unique").on(table.tenantId, table.effectiveFrom),
  foreignKey({ name: "articleship_policies_creator_membership_fk", columns: [table.tenantId, table.createdByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("articleship_policies_lookup_idx").on(table.tenantId, table.effectiveFrom),
  check("articleship_policies_months_check", sql`${table.trainingMonths} between 1 and 60`),
  check("articleship_policies_fraction_check", sql`${table.leaveFractionNumerator} between 1 and 100 and ${table.leaveFractionDenominator} between 1 and 100 and ${table.leaveFractionNumerator} <= ${table.leaveFractionDenominator}`),
  check("articleship_policies_note_check", sql`length(${table.note}) <= 500`),
]);

/**
 * One article's training under one principal.
 *
 * A transfer is not an edit — it ends this registration and begins another, so
 * the register keeps the chain a principal has to be able to produce rather than
 * overwriting it. `trainingMonths` is snapshotted at commencement for the same
 * reason the work budget is: a policy revised next year must not silently move
 * an existing article's completion date.
 */
export const articleshipRegistrations = pgTable("articleship_registrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  articleUserId: uuid("article_user_id").notNull(),
  /** The member the article is registered under. */
  principalUserId: uuid("principal_user_id").notNull(),
  status: text("status").notNull().default("active"),
  commencedOn: date("commenced_on", { mode: "string" }).notNull(),
  trainingMonths: integer("training_months").notNull(),
  /** ICAI's own reference for the registration, where the firm has one. */
  registrationNumber: text("registration_number").notNull().default(""),
  deedDate: date("deed_date", { mode: "string" }),
  form103Date: date("form_103_date", { mode: "string" }),
  form109Date: date("form_109_date", { mode: "string" }),
  form108Date: date("form_108_date", { mode: "string" }),
  endedOn: date("ended_on", { mode: "string" }),
  endReason: text("end_reason").notNull().default(""),
  industrialTrainingFrom: date("industrial_training_from", { mode: "string" }),
  industrialTrainingTo: date("industrial_training_to", { mode: "string" }),
  industrialTrainingEmployer: text("industrial_training_employer").notNull().default(""),
  note: text("note").notNull().default(""),
  createdByUserId: uuid("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("articleship_registrations_tenant_id_unique").on(table.tenantId, table.id),
  // An article trains under one principal at a time. Two live registrations
  // would make every date on the register ambiguous.
  uniqueIndex("articleship_registrations_active_unique").on(table.tenantId, table.articleUserId).where(sql`${table.status} = 'active'`),
  foreignKey({ name: "articleship_article_membership_fk", columns: [table.tenantId, table.articleUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "articleship_principal_membership_fk", columns: [table.tenantId, table.principalUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "articleship_creator_membership_fk", columns: [table.tenantId, table.createdByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("articleship_registrations_status_idx").on(table.tenantId, table.status, table.commencedOn),
  index("articleship_registrations_principal_idx").on(table.tenantId, table.principalUserId, table.status),
  check("articleship_status_check", sql`${table.status} in ('active', 'transferred', 'terminated', 'completed')`),
  check("articleship_months_check", sql`${table.trainingMonths} between 1 and 60`),
  // Nobody is their own principal.
  check("articleship_principal_check", sql`${table.principalUserId} <> ${table.articleUserId}`),
  // A registration that has ended has to say when, and an active one has not.
  check("articleship_ended_state_check", sql`(${table.status} = 'active' and ${table.endedOn} is null) or (${table.status} <> 'active' and ${table.endedOn} is not null)`),
  check("articleship_ended_order_check", sql`${table.endedOn} is null or ${table.endedOn} >= ${table.commencedOn}`),
  // Completion is evidenced by Form 108; ending early, by Form 109.
  check("articleship_completed_form_check", sql`${table.status} <> 'completed' or ${table.form108Date} is not null`),
  check("articleship_industrial_range_check", sql`(${table.industrialTrainingFrom} is null) = (${table.industrialTrainingTo} is null) and (${table.industrialTrainingTo} is null or ${table.industrialTrainingTo} >= ${table.industrialTrainingFrom})`),
  check("articleship_text_check", sql`length(${table.registrationNumber}) <= 40 and length(${table.endReason}) <= 300 and length(${table.industrialTrainingEmployer}) <= 160 and length(${table.note}) <= 500`),
]);

export const leaveTypes = pgTable("leave_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  paidByDefault: boolean("paid_by_default").notNull().default(true),
  allowsHalfDay: boolean("allows_half_day").notNull().default(true),
  requiresReason: boolean("requires_reason").notNull().default(true),
  annualQuotaDays: integer("annual_quota_days").notNull().default(0),
  // How the annual entitlement is granted. `annual` credits the whole quota at
  // the start of the leave year, pro-rated for anyone who joins or leaves part
  // way through; `monthly` credits a twelfth each completed month; `none` grants
  // nothing automatically, for types like maternity that are sanctioned case by
  // case and posted as an adjustment.
  accrualMethod: text("accrual_method").notNull().default("annual"),
  // Days of unused entitlement that survive into the next leave year. 0 = none.
  carryForwardCap: integer("carry_forward_cap").notNull().default(0),
  // Months into the new year after which anything carried lapses. Null = never.
  carryForwardExpiryMonths: integer("carry_forward_expiry_months"),
  encashableOnExit: boolean("encashable_on_exit").notNull().default(false),
  displayOrder: integer("display_order").notNull().default(10),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("leave_types_tenant_id_unique").on(table.tenantId, table.id),
  uniqueIndex("leave_types_tenant_code_lower_unique").on(table.tenantId, sql`lower(${table.code})`),
  index("leave_types_tenant_status_idx").on(table.tenantId, table.status, table.displayOrder),
  check("leave_types_code_check", sql`${table.code} ~ '^[a-z][a-z0-9_]{1,29}$'`),
  check("leave_types_name_check", sql`length(trim(${table.name})) between 2 and 60`),
  check("leave_types_quota_check", sql`${table.annualQuotaDays} between 0 and 365`),
  check("leave_types_accrual_method_check", sql`${table.accrualMethod} in ('annual', 'monthly', 'none')`),
  check("leave_types_carry_forward_cap_check", sql`${table.carryForwardCap} between 0 and 365`),
  check("leave_types_carry_forward_expiry_check", sql`${table.carryForwardExpiryMonths} is null or ${table.carryForwardExpiryMonths} between 1 and 12`),
  // An expiry with nothing to expire is a setting that cannot mean anything.
  check("leave_types_carry_forward_pair_check", sql`${table.carryForwardCap} > 0 or ${table.carryForwardExpiryMonths} is null`),
  check("leave_types_order_check", sql`${table.displayOrder} between 0 and 999`),
  check("leave_types_status_check", sql`${table.status} in ('active', 'archived')`),
]);

export const holidayCalendar = pgTable("holiday_calendar", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  holidayDate: date("holiday_date", { mode: "string" }).notNull(),
  name: text("name").notNull(),
  holidayType: text("holiday_type").notNull().default("public"),
  jurisdictionState: text("jurisdiction_state").notNull().default("Bihar"),
  status: text("status").notNull().default("active"),
  createdByUserId: uuid("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("holiday_calendar_tenant_id_unique").on(table.tenantId, table.id),
  uniqueIndex("holiday_calendar_tenant_date_state_unique").on(table.tenantId, table.holidayDate, sql`lower(${table.jurisdictionState})`),
  foreignKey({ name: "holiday_calendar_creator_membership_fk", columns: [table.tenantId, table.createdByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("holiday_calendar_tenant_date_idx").on(table.tenantId, table.status, table.holidayDate),
  check("holiday_calendar_name_check", sql`length(trim(${table.name})) between 2 and 80`),
  check("holiday_calendar_type_check", sql`${table.holidayType} in ('public', 'restricted', 'optional')`),
  check("holiday_calendar_state_check", sql`length(trim(${table.jurisdictionState})) between 2 and 40`),
  check("holiday_calendar_status_check", sql`${table.status} in ('active', 'archived')`),
]);

export const shiftTypes = pgTable("shift_types", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  startTime: text("start_time").notNull().default("09:30"),
  endTime: text("end_time").notNull().default("18:00"),
  fullDayMinutes: integer("full_day_minutes").notNull().default(450),
  halfDayMinutes: integer("half_day_minutes").notNull().default(225),
  lateGraceMinutes: integer("late_grace_minutes").notNull().default(15),
  workingWeekMask: text("working_week_mask").notNull().default("1111110"),
  isDefault: boolean("is_default").notNull().default(false),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("shift_types_tenant_id_unique").on(table.tenantId, table.id),
  uniqueIndex("shift_types_tenant_code_lower_unique").on(table.tenantId, sql`lower(${table.code})`),
  uniqueIndex("shift_types_tenant_default_unique").on(table.tenantId).where(sql`${table.isDefault} and ${table.status} = 'active'`),
  index("shift_types_tenant_status_idx").on(table.tenantId, table.status, table.name),
  check("shift_types_code_check", sql`${table.code} ~ '^[A-Z0-9][A-Z0-9_-]{1,19}$'`),
  check("shift_types_name_check", sql`length(trim(${table.name})) between 2 and 60`),
  check("shift_types_time_check", sql`${table.startTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and ${table.endTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and ${table.startTime} < ${table.endTime}`),
  check("shift_types_week_mask_check", sql`${table.workingWeekMask} ~ '^[01]{7}$' and ${table.workingWeekMask} like '%1%'`),
  check("shift_types_minutes_check", sql`${table.lateGraceMinutes} between 0 and 180 and ${table.fullDayMinutes} between 60 and 960 and ${table.halfDayMinutes} between 30 and ${table.fullDayMinutes} - 1`),
  check("shift_types_status_check", sql`${table.status} in ('active', 'archived')`),
]);

export const attendancePolicies = pgTable("attendance_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  jurisdictionState: text("jurisdiction_state").notNull().default("Bihar"),
  timeZone: text("time_zone").notNull().default("Asia/Kolkata"),
  workingWeekMask: text("working_week_mask").notNull().default("1111110"),
  standardStartTime: text("standard_start_time").notNull().default("09:30"),
  standardEndTime: text("standard_end_time").notNull().default("18:00"),
  lateGraceMinutes: integer("late_grace_minutes").notNull().default(15),
  fullDayMinutes: integer("full_day_minutes").notNull().default(450),
  halfDayMinutes: integer("half_day_minutes").notNull().default(225),
  createdByUserId: uuid("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("attendance_policies_tenant_effective_unique").on(table.tenantId, table.effectiveFrom),
  unique("attendance_policies_tenant_id_unique").on(table.tenantId, table.id),
  foreignKey({ name: "attendance_policies_creator_membership_fk", columns: [table.tenantId, table.createdByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("attendance_policies_tenant_effective_idx").on(table.tenantId, table.effectiveFrom),
  check("attendance_policies_week_mask_check", sql`${table.workingWeekMask} ~ '^[01]{7}$' and ${table.workingWeekMask} like '%1%'`),
  check("attendance_policies_effective_month_check", sql`extract(day from ${table.effectiveFrom}) = 1`),
  check("attendance_policies_time_check", sql`${table.standardStartTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and ${table.standardEndTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and ${table.standardStartTime} < ${table.standardEndTime}`),
  check("attendance_policies_minutes_check", sql`${table.lateGraceMinutes} between 0 and 180 and ${table.fullDayMinutes} between 60 and 960 and ${table.halfDayMinutes} between 30 and ${table.fullDayMinutes} - 1`),
]);

export const employeeWorkProfiles = pgTable("employee_work_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  employeeUserId: uuid("employee_user_id").notNull(),
  managerUserId: uuid("manager_user_id"),
  employmentType: text("employment_type").notNull().default("employee"),
  workLocationState: text("work_location_state").notNull().default("Bihar"),
  // Null falls back to the tenant attendance policy, so existing profiles keep working.
  shiftTypeId: uuid("shift_type_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("employee_work_profiles_tenant_employee_unique").on(table.tenantId, table.employeeUserId),
  foreignKey({ name: "employee_work_profiles_employee_membership_fk", columns: [table.tenantId, table.employeeUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "employee_work_profiles_shift_tenant_fk", columns: [table.tenantId, table.shiftTypeId], foreignColumns: [shiftTypes.tenantId, shiftTypes.id] }),
  foreignKey({ name: "employee_work_profiles_manager_membership_fk", columns: [table.tenantId, table.managerUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("employee_work_profiles_manager_idx").on(table.tenantId, table.managerUserId),
  check("employee_work_profiles_type_check", sql`${table.employmentType} in ('employee', 'articled_assistant')`),
  check("employee_work_profiles_manager_check", sql`${table.managerUserId} is null or ${table.managerUserId} <> ${table.employeeUserId}`),
]);

export const attendanceDays = pgTable("attendance_days", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  employeeUserId: uuid("employee_user_id").notNull(),
  attendanceDate: date("attendance_date", { mode: "string" }).notNull(),
  status: text("status").notNull(),
  firstCheckIn: timestamp("first_check_in", { withTimezone: true }),
  lastCheckOut: timestamp("last_check_out", { withTimezone: true }),
  workedMinutes: integer("worked_minutes").notNull().default(0),
  lateMinutes: integer("late_minutes").notNull().default(0),
  paidHalfDays: integer("paid_half_days").notNull().default(0),
  lopHalfDays: integer("lop_half_days").notNull().default(0),
  source: text("source").notNull().default("self_service"),
  note: text("note").notNull().default(""),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("attendance_days_tenant_employee_date_unique").on(table.tenantId, table.employeeUserId, table.attendanceDate),
  unique("attendance_days_tenant_id_unique").on(table.tenantId, table.id),
  foreignKey({ name: "attendance_days_employee_membership_fk", columns: [table.tenantId, table.employeeUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("attendance_days_tenant_date_idx").on(table.tenantId, table.attendanceDate),
  check("attendance_days_status_check", sql`${table.status} in ('present', 'absent', 'leave', 'half_day', 'late', 'missing_punch', 'weekly_off', 'holiday', 'wfh', 'tour')`),
  check("attendance_days_minutes_check", sql`${table.workedMinutes} >= 0 and ${table.lateMinutes} >= 0 and ${table.paidHalfDays} between 0 and 2 and ${table.lopHalfDays} between 0 and 2`),
  check("attendance_days_time_order_check", sql`${table.firstCheckIn} is null or ${table.lastCheckOut} is null or ${table.lastCheckOut} > ${table.firstCheckIn}`),
  check("attendance_days_version_check", sql`${table.version} > 0`),
]);

export const attendanceEvents = pgTable("attendance_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  attendanceDayId: uuid("attendance_day_id").notNull(),
  employeeUserId: uuid("employee_user_id").notNull(),
  actorUserId: uuid("actor_user_id").notNull(),
  eventType: text("event_type").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  source: text("source").notNull(),
  note: text("note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: "attendance_events_day_tenant_fk", columns: [table.tenantId, table.attendanceDayId], foreignColumns: [attendanceDays.tenantId, attendanceDays.id] }),
  foreignKey({ name: "attendance_events_employee_membership_fk", columns: [table.tenantId, table.employeeUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "attendance_events_actor_membership_fk", columns: [table.tenantId, table.actorUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("attendance_events_day_idx").on(table.tenantId, table.attendanceDayId, table.occurredAt),
  check("attendance_events_type_check", sql`${table.eventType} in ('check_in', 'check_out', 'manual_record', 'leave_approved', 'correction_approved')`),
  check("attendance_events_source_check", sql`${table.source} in ('self_service', 'manager', 'administrator', 'system')`),
]);

export const leaveRequests = pgTable("leave_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  employeeUserId: uuid("employee_user_id").notNull(),
  dateFrom: date("date_from", { mode: "string" }).notNull(),
  dateTo: date("date_to", { mode: "string" }).notNull(),
  leaveType: text("leave_type").notNull(),
  dayPortion: text("day_portion").notNull().default("full"),
  paidClassification: text("paid_classification").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending"),
  reviewerUserId: uuid("reviewer_user_id"),
  decisionNote: text("decision_note").notNull().default(""),
  // Why a reviewer approved leave the employee had no entitlement left for.
  // Firms do grant exceptions; one that cannot be recorded is taken anyway and
  // leaves the register looking as though the balance was never exceeded.
  quotaExceptionReason: text("quota_exception_reason").notNull().default(""),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: "leave_requests_employee_membership_fk", columns: [table.tenantId, table.employeeUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "leave_requests_reviewer_membership_fk", columns: [table.tenantId, table.reviewerUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("leave_requests_tenant_status_idx").on(table.tenantId, table.status, table.dateFrom),
  check("leave_requests_date_check", sql`${table.dateTo} >= ${table.dateFrom}`),
  // Leave types are firm-defined master data; the shape is constrained, the list is not.
  check("leave_requests_type_check", sql`${table.leaveType} ~ '^[a-z][a-z0-9_]{1,29}$'`),
  check("leave_requests_portion_check", sql`${table.dayPortion} in ('full', 'first_half', 'second_half')`),
  check("leave_requests_paid_check", sql`${table.paidClassification} in ('paid', 'unpaid')`),
  check("leave_requests_status_check", sql`${table.status} in ('pending', 'approved', 'rejected', 'cancelled')`),
  check("leave_requests_reviewer_check", sql`${table.reviewerUserId} is null or ${table.reviewerUserId} <> ${table.employeeUserId}`),
  check("leave_requests_decision_check", sql`(${table.status} in ('approved', 'rejected') and ${table.reviewerUserId} is not null and ${table.decidedAt} is not null) or (${table.status} in ('pending', 'cancelled') and ${table.decidedAt} is null)`),
  check("leave_requests_quota_exception_check", sql`length(${table.quotaExceptionReason}) <= 500 and (${table.quotaExceptionReason} = '' or ${table.status} = 'approved')`),
]);

/**
 * The leave entitlement ledger: every grant and every consumption, posted once
 * and never edited.
 *
 * A balance is derived — the sum of these rows for one employee, one leave type,
 * one leave year. Storing the running total instead would make a correction
 * indistinguishable from a mistake, and the question an employee actually asks
 * is not "what is my balance" but "how did it get to that", which only a ledger
 * can answer. Machine-generated postings carry a `dedupeKey` so re-running the
 * accrual job cannot credit the same month twice.
 */
export const leaveLedgerEntries = pgTable("leave_ledger_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  employeeUserId: uuid("employee_user_id").notNull(),
  leaveTypeCode: text("leave_type_code").notNull(),
  /** The financial year the posting belongs to, `2026-27`. */
  leaveYear: text("leave_year").notNull(),
  entryType: text("entry_type").notNull(),
  /** Signed half-days. Positive grants entitlement, negative consumes it. */
  halfDays: integer("half_days").notNull(),
  effectiveDate: date("effective_date", { mode: "string" }).notNull(),
  sourceType: text("source_type").notNull().default(""),
  sourceId: uuid("source_id"),
  reason: text("reason").notNull().default(""),
  /** Null for postings the accrual job makes on its own behalf. */
  actorUserId: uuid("actor_user_id"),
  dedupeKey: text("dedupe_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("leave_ledger_entries_tenant_id_unique").on(table.tenantId, table.id),
  // Scoped to the employee, not just the tenant: a key like
  // `accrual:casual:2026-27:annual` describes one person's grant, and every
  // colleague generates the same string. Tenant-wide, the first employee to be
  // credited would claim the key and the rest would be silently skipped.
  uniqueIndex("leave_ledger_entries_employee_dedupe_unique").on(table.tenantId, table.employeeUserId, table.dedupeKey).where(sql`${table.dedupeKey} is not null`),
  foreignKey({ name: "leave_ledger_employee_membership_fk", columns: [table.tenantId, table.employeeUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "leave_ledger_actor_membership_fk", columns: [table.tenantId, table.actorUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("leave_ledger_balance_idx").on(table.tenantId, table.employeeUserId, table.leaveTypeCode, table.leaveYear),
  index("leave_ledger_year_type_idx").on(table.tenantId, table.leaveYear, table.entryType),
  check("leave_ledger_type_code_check", sql`${table.leaveTypeCode} ~ '^[a-z][a-z0-9_]{1,29}$'`),
  check("leave_ledger_year_check", sql`${table.leaveYear} ~ '^[0-9]{4}-[0-9]{2}$'`),
  check("leave_ledger_entry_type_check", sql`${table.entryType} in ('opening', 'accrual', 'carry_forward', 'consumption', 'reversal', 'lapse', 'encashment', 'adjustment')`),
  // A zero posting records nothing and would only dilute the trail.
  check("leave_ledger_half_days_check", sql`${table.halfDays} <> 0 and ${table.halfDays} between -1460 and 1460`),
  // Each kind of posting can only move the balance one way. An `accrual` that
  // took entitlement away would be a bug wearing the wrong label.
  check("leave_ledger_direction_check", sql`(${table.entryType} in ('opening', 'accrual', 'carry_forward') and ${table.halfDays} > 0) or (${table.entryType} in ('consumption', 'lapse', 'encashment') and ${table.halfDays} < 0) or ${table.entryType} in ('reversal', 'adjustment')`),
  check("leave_ledger_source_check", sql`${table.sourceType} in ('', 'leave_request', 'accrual_job', 'manual')`),
  check("leave_ledger_source_pair_check", sql`(${table.sourceType} = 'leave_request') = (${table.sourceId} is not null)`),
  check("leave_ledger_reason_check", sql`length(${table.reason}) <= 500`),
  // A hand-made posting has to say who made it and why; an automatic one never
  // needs to, and claiming an actor it does not have would be a false trail.
  check("leave_ledger_manual_check", sql`${table.entryType} not in ('reversal', 'adjustment') or (${table.actorUserId} is not null and length(trim(${table.reason})) > 0)`),
]);

export const attendanceCorrectionRequests = pgTable("attendance_correction_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  employeeUserId: uuid("employee_user_id").notNull(),
  attendanceDate: date("attendance_date", { mode: "string" }).notNull(),
  sourceAttendanceDayId: uuid("source_attendance_day_id"),
  sourceVersion: integer("source_version").notNull().default(0),
  originalSnapshot: text("original_snapshot").notNull(),
  proposedStatus: text("proposed_status").notNull(),
  proposedCheckIn: timestamp("proposed_check_in", { withTimezone: true }),
  proposedCheckOut: timestamp("proposed_check_out", { withTimezone: true }),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending"),
  reviewerUserId: uuid("reviewer_user_id"),
  decisionNote: text("decision_note").notNull().default(""),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: "attendance_corrections_employee_membership_fk", columns: [table.tenantId, table.employeeUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "attendance_corrections_reviewer_membership_fk", columns: [table.tenantId, table.reviewerUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "attendance_corrections_day_tenant_fk", columns: [table.tenantId, table.sourceAttendanceDayId], foreignColumns: [attendanceDays.tenantId, attendanceDays.id] }),
  uniqueIndex("attendance_corrections_pending_unique").on(table.tenantId, table.employeeUserId, table.attendanceDate).where(sql`${table.status} = 'pending'`),
  index("attendance_corrections_tenant_status_idx").on(table.tenantId, table.status, table.attendanceDate),
  check("attendance_corrections_status_value_check", sql`${table.proposedStatus} in ('present', 'absent', 'leave', 'half_day', 'late', 'missing_punch', 'weekly_off', 'holiday', 'wfh', 'tour')`),
  check("attendance_corrections_status_check", sql`${table.status} in ('pending', 'approved', 'rejected', 'cancelled')`),
  check("attendance_corrections_version_check", sql`${table.sourceVersion} >= 0`),
  check("attendance_corrections_time_check", sql`${table.proposedCheckIn} is null or ${table.proposedCheckOut} is null or ${table.proposedCheckOut} > ${table.proposedCheckIn}`),
  check("attendance_corrections_reviewer_check", sql`${table.reviewerUserId} is null or ${table.reviewerUserId} <> ${table.employeeUserId}`),
]);

export const attendancePeriods = pgTable("attendance_periods", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  periodKey: text("period_key").notNull(),
  policyId: uuid("policy_id").notNull(),
  status: text("status").notNull().default("open"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedByUserId: uuid("reviewed_by_user_id"),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lockedByUserId: uuid("locked_by_user_id"),
  reopenReason: text("reopen_reason").notNull().default(""),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("attendance_periods_tenant_period_unique").on(table.tenantId, table.periodKey),
  unique("attendance_periods_tenant_id_unique").on(table.tenantId, table.id),
  foreignKey({ name: "attendance_periods_reviewer_membership_fk", columns: [table.tenantId, table.reviewedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "attendance_periods_locker_membership_fk", columns: [table.tenantId, table.lockedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "attendance_periods_policy_tenant_fk", columns: [table.tenantId, table.policyId], foreignColumns: [attendancePolicies.tenantId, attendancePolicies.id] }),
  index("attendance_periods_tenant_status_idx").on(table.tenantId, table.status, table.periodKey),
  check("attendance_periods_period_check", sql`${table.periodKey} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  check("attendance_periods_status_check", sql`${table.status} in ('open', 'review', 'locked')`),
  check("attendance_periods_locked_state_check", sql`(${table.status} = 'open' and ${table.reviewedAt} is null and ${table.lockedAt} is null) or (${table.status} = 'review' and ${table.reviewedAt} is not null and ${table.lockedAt} is null) or (${table.status} = 'locked' and ${table.reviewedAt} is not null and ${table.lockedAt} is not null and ${table.lockedByUserId} is not null)`),
  check("attendance_periods_version_check", sql`${table.version} > 0`),
]);

export const attendancePeriodSummaries = pgTable("attendance_period_summaries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  attendancePeriodId: uuid("attendance_period_id").notNull(),
  employeeUserId: uuid("employee_user_id").notNull(),
  periodScheduledHalfDays: integer("period_scheduled_half_days").notNull(),
  employmentExcludedHalfDays: integer("employment_excluded_half_days").notNull(),
  scheduledHalfDays: integer("scheduled_half_days").notNull(),
  payableHalfDays: integer("payable_half_days").notNull(),
  lopHalfDays: integer("lop_half_days").notNull(),
  presentDays: integer("present_days").notNull(),
  paidLeaveHalfDays: integer("paid_leave_half_days").notNull(),
  unpaidLeaveHalfDays: integer("unpaid_leave_half_days").notNull(),
  absenceHalfDays: integer("absence_half_days").notNull(),
  overtimeMinutes: integer("overtime_minutes").notNull(),
  lateCount: integer("late_count").notNull(),
  sourceHash: text("source_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("attendance_summaries_period_employee_unique").on(table.tenantId, table.attendancePeriodId, table.employeeUserId),
  unique("attendance_summaries_tenant_id_unique").on(table.tenantId, table.id),
  foreignKey({ name: "attendance_summaries_period_tenant_fk", columns: [table.tenantId, table.attendancePeriodId], foreignColumns: [attendancePeriods.tenantId, attendancePeriods.id] }),
  foreignKey({ name: "attendance_summaries_employee_membership_fk", columns: [table.tenantId, table.employeeUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("attendance_summaries_employee_idx").on(table.tenantId, table.employeeUserId, table.attendancePeriodId),
  check("attendance_summaries_units_check", sql`${table.periodScheduledHalfDays} > 0 and ${table.scheduledHalfDays} >= 0 and ${table.employmentExcludedHalfDays} >= 0 and ${table.scheduledHalfDays} + ${table.employmentExcludedHalfDays} = ${table.periodScheduledHalfDays} and ${table.payableHalfDays} >= 0 and ${table.lopHalfDays} >= 0 and ${table.payableHalfDays} + ${table.lopHalfDays} = ${table.scheduledHalfDays} and ${table.presentDays} >= 0 and ${table.paidLeaveHalfDays} >= 0 and ${table.unpaidLeaveHalfDays} >= 0 and ${table.absenceHalfDays} >= 0 and ${table.overtimeMinutes} >= 0 and ${table.lateCount} >= 0`),
]);

export const salaryStructures = pgTable("salary_structures", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  employeeUserId: uuid("employee_user_id").notNull(),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  status: text("status").notNull().default("active"),
  createdByUserId: uuid("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("salary_structures_employee_effective_unique").on(table.tenantId, table.employeeUserId, table.effectiveFrom),
  unique("salary_structures_tenant_id_unique").on(table.tenantId, table.id),
  foreignKey({ name: "salary_structures_employee_membership_fk", columns: [table.tenantId, table.employeeUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "salary_structures_creator_membership_fk", columns: [table.tenantId, table.createdByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("salary_structures_employee_effective_idx").on(table.tenantId, table.employeeUserId, table.effectiveFrom),
  check("salary_structures_status_check", sql`${table.status} in ('active', 'superseded')`),
]);

export const salaryStructureLines = pgTable("salary_structure_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  salaryStructureId: uuid("salary_structure_id").notNull(),
  code: text("code").notNull(),
  label: text("label").notNull(),
  kind: text("kind").notNull(),
  monthlyAmountPaise: bigint("monthly_amount_paise", { mode: "number" }).notNull(),
  displayOrder: integer("display_order").notNull().default(0),
}, (table) => [
  unique("salary_lines_structure_code_unique").on(table.tenantId, table.salaryStructureId, table.code),
  foreignKey({ name: "salary_lines_structure_tenant_fk", columns: [table.tenantId, table.salaryStructureId], foreignColumns: [salaryStructures.tenantId, salaryStructures.id] }),
  index("salary_lines_structure_idx").on(table.tenantId, table.salaryStructureId, table.displayOrder),
  check("salary_lines_code_check", sql`${table.code} ~ '^[A-Z][A-Z0-9_]{1,29}$'`),
  check("salary_lines_kind_check", sql`${table.kind} in ('earning', 'deduction', 'employer_contribution')`),
  check("salary_lines_amount_check", sql`${table.monthlyAmountPaise} >= 0`),
]);

export const payrollRuns = pgTable("payroll_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  attendancePeriodId: uuid("attendance_period_id").notNull(),
  periodKey: text("period_key").notNull(),
  status: text("status").notNull().default("draft"),
  payDate: date("pay_date", { mode: "string" }).notNull(),
  preparedByUserId: uuid("prepared_by_user_id").notNull(),
  submittedByUserId: uuid("submitted_by_user_id"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  approvedByUserId: uuid("approved_by_user_id"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  publishedByUserId: uuid("published_by_user_id"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  paidByUserId: uuid("paid_by_user_id"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  paymentReference: text("payment_reference").notNull().default(""),
  transitionReason: text("transition_reason").notNull().default(""),
  totalGrossPaise: bigint("total_gross_paise", { mode: "number" }).notNull().default(0),
  totalDeductionsPaise: bigint("total_deductions_paise", { mode: "number" }).notNull().default(0),
  totalNetPaise: bigint("total_net_paise", { mode: "number" }).notNull().default(0),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("payroll_runs_tenant_period_unique").on(table.tenantId, table.periodKey),
  unique("payroll_runs_tenant_id_unique").on(table.tenantId, table.id),
  foreignKey({ name: "payroll_runs_attendance_period_tenant_fk", columns: [table.tenantId, table.attendancePeriodId], foreignColumns: [attendancePeriods.tenantId, attendancePeriods.id] }),
  foreignKey({ name: "payroll_runs_preparer_membership_fk", columns: [table.tenantId, table.preparedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "payroll_runs_submitter_membership_fk", columns: [table.tenantId, table.submittedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "payroll_runs_approver_membership_fk", columns: [table.tenantId, table.approvedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "payroll_runs_publisher_membership_fk", columns: [table.tenantId, table.publishedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "payroll_runs_payer_membership_fk", columns: [table.tenantId, table.paidByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("payroll_runs_tenant_status_idx").on(table.tenantId, table.status, table.periodKey),
  check("payroll_runs_period_check", sql`${table.periodKey} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  check("payroll_runs_status_check", sql`${table.status} in ('draft', 'submitted', 'approved_locked', 'payslips_published', 'paid')`),
  check("payroll_runs_money_check", sql`${table.totalGrossPaise} >= 0 and ${table.totalDeductionsPaise} >= 0 and ${table.totalNetPaise} >= 0`),
  check("payroll_runs_state_timestamps_check", sql`(${table.status} = 'draft' and ${table.submittedAt} is null and ${table.approvedAt} is null and ${table.publishedAt} is null and ${table.paidAt} is null) or (${table.status} = 'submitted' and ${table.submittedAt} is not null and ${table.approvedAt} is null and ${table.publishedAt} is null and ${table.paidAt} is null) or (${table.status} = 'approved_locked' and ${table.submittedAt} is not null and ${table.approvedAt} is not null and ${table.publishedAt} is null and ${table.paidAt} is null) or (${table.status} = 'payslips_published' and ${table.submittedAt} is not null and ${table.approvedAt} is not null and ${table.publishedAt} is not null and ${table.paidAt} is null) or (${table.status} = 'paid' and ${table.submittedAt} is not null and ${table.approvedAt} is not null and ${table.publishedAt} is not null and ${table.paidAt} is not null)`),
  check("payroll_runs_version_check", sql`${table.version} > 0`),
]);

export const payrollEntries = pgTable("payroll_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  payrollRunId: uuid("payroll_run_id").notNull(),
  employeeUserId: uuid("employee_user_id").notNull(),
  salaryStructureId: uuid("salary_structure_id").notNull(),
  employeeCodeSnapshot: text("employee_code_snapshot").notNull(),
  employeeNameSnapshot: text("employee_name_snapshot").notNull(),
  designationSnapshot: text("designation_snapshot").notNull(),
  periodScheduledHalfDays: integer("period_scheduled_half_days").notNull(),
  employmentExcludedHalfDays: integer("employment_excluded_half_days").notNull(),
  scheduledHalfDays: integer("scheduled_half_days").notNull(),
  payableHalfDays: integer("payable_half_days").notNull(),
  lopHalfDays: integer("lop_half_days").notNull(),
  fullGrossPaise: bigint("full_gross_paise", { mode: "number" }).notNull(),
  earnedGrossPaise: bigint("earned_gross_paise", { mode: "number" }).notNull(),
  employmentProrationDeductionPaise: bigint("employment_proration_deduction_paise", { mode: "number" }).notNull(),
  attendanceDeductionPaise: bigint("attendance_deduction_paise", { mode: "number" }).notNull(),
  recurringDeductionPaise: bigint("recurring_deduction_paise", { mode: "number" }).notNull(),
  oneTimeAdditionPaise: bigint("one_time_addition_paise", { mode: "number" }).notNull().default(0),
  oneTimeDeductionPaise: bigint("one_time_deduction_paise", { mode: "number" }).notNull().default(0),
  employeeProvidentFundPaise: bigint("employee_provident_fund_paise", { mode: "number" }).notNull().default(0),
  employeeStateInsurancePaise: bigint("employee_state_insurance_paise", { mode: "number" }).notNull().default(0),
  professionalTaxPaise: bigint("professional_tax_paise", { mode: "number" }).notNull().default(0),
  incomeTaxPaise: bigint("income_tax_paise", { mode: "number" }).notNull().default(0),
  totalDeductionsPaise: bigint("total_deductions_paise", { mode: "number" }).notNull(),
  netPayPaise: bigint("net_pay_paise", { mode: "number" }).notNull(),
  employerCostPaise: bigint("employer_cost_paise", { mode: "number" }).notNull(),
  hold: boolean("hold").notNull().default(false),
  holdReason: text("hold_reason").notNull().default(""),
  note: text("note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("payroll_entries_run_employee_unique").on(table.tenantId, table.payrollRunId, table.employeeUserId),
  unique("payroll_entries_tenant_id_unique").on(table.tenantId, table.id),
  foreignKey({ name: "payroll_entries_run_tenant_fk", columns: [table.tenantId, table.payrollRunId], foreignColumns: [payrollRuns.tenantId, payrollRuns.id] }),
  foreignKey({ name: "payroll_entries_employee_membership_fk", columns: [table.tenantId, table.employeeUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "payroll_entries_salary_tenant_fk", columns: [table.tenantId, table.salaryStructureId], foreignColumns: [salaryStructures.tenantId, salaryStructures.id] }),
  index("payroll_entries_employee_idx").on(table.tenantId, table.employeeUserId, table.payrollRunId),
  check("payroll_entries_units_check", sql`${table.periodScheduledHalfDays} > 0 and ${table.scheduledHalfDays} >= 0 and ${table.employmentExcludedHalfDays} >= 0 and ${table.scheduledHalfDays} + ${table.employmentExcludedHalfDays} = ${table.periodScheduledHalfDays} and ${table.payableHalfDays} >= 0 and ${table.lopHalfDays} >= 0 and ${table.payableHalfDays} + ${table.lopHalfDays} = ${table.scheduledHalfDays}`),
  check("payroll_entries_money_check", sql`${table.fullGrossPaise} >= 0 and ${table.earnedGrossPaise} >= 0 and ${table.employmentProrationDeductionPaise} >= 0 and ${table.attendanceDeductionPaise} >= 0 and ${table.recurringDeductionPaise} >= 0 and ${table.oneTimeAdditionPaise} >= 0 and ${table.oneTimeDeductionPaise} >= 0 and ${table.employeeProvidentFundPaise} >= 0 and ${table.employeeStateInsurancePaise} >= 0 and ${table.professionalTaxPaise} >= 0 and ${table.incomeTaxPaise} >= 0 and ${table.totalDeductionsPaise} >= 0 and ${table.netPayPaise} >= 0 and ${table.employerCostPaise} >= 0`),
  check("payroll_entries_hold_check", sql`not ${table.hold} or length(trim(${table.holdReason})) > 0`),
]);

export const payrollEntryLines = pgTable("payroll_entry_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  payrollEntryId: uuid("payroll_entry_id").notNull(),
  code: text("code").notNull(),
  label: text("label").notNull(),
  kind: text("kind").notNull(),
  source: text("source").notNull(),
  amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("payroll_entry_lines_entry_code_unique").on(table.tenantId, table.payrollEntryId, table.code),
  foreignKey({ name: "payroll_entry_lines_entry_tenant_fk", columns: [table.tenantId, table.payrollEntryId], foreignColumns: [payrollEntries.tenantId, payrollEntries.id] }),
  index("payroll_entry_lines_entry_idx").on(table.tenantId, table.payrollEntryId),
  check("payroll_entry_lines_kind_check", sql`${table.kind} in ('earning', 'deduction', 'employer_contribution')`),
  check("payroll_entry_lines_source_check", sql`${table.source} in ('salary_structure', 'employment', 'attendance', 'adjustment', 'statutory')`),
  check("payroll_entry_lines_amount_check", sql`${table.amountPaise} >= 0`),
]);

/**
 * Master list of documents the firm routinely needs from clients. Maintained once
 * under Settings, then picked when raising a request so titles and instructions
 * stay consistent instead of being retyped.
 */
export const documentChecklistItems = pgTable("document_checklist_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  code: text("code").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull().default("General"),
  instructions: text("instructions").notNull().default(""),
  serviceCode: text("service_code").notNull().default(""),
  defaultLeadDays: integer("default_lead_days").notNull().default(7),
  mandatory: boolean("mandatory").notNull().default(true),
  status: text("status").notNull().default("active"),
  createdByUserId: uuid("created_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("document_checklist_items_tenant_id_unique").on(table.tenantId, table.id),
  uniqueIndex("document_checklist_items_tenant_code_lower_unique").on(table.tenantId, sql`lower(${table.code})`),
  foreignKey({ name: "document_checklist_items_creator_membership_fk", columns: [table.tenantId, table.createdByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("document_checklist_items_tenant_status_idx").on(table.tenantId, table.status, table.category),
  check("document_checklist_items_code_check", sql`${table.code} ~ '^[A-Z0-9][A-Z0-9_-]{1,29}$'`),
  check("document_checklist_items_name_check", sql`length(trim(${table.name})) between 2 and 120`),
  check("document_checklist_items_category_check", sql`length(trim(${table.category})) between 2 and 40`),
  check("document_checklist_items_instructions_check", sql`length(${table.instructions}) <= 500`),
  check("document_checklist_items_service_check", sql`${table.serviceCode} = '' or ${table.serviceCode} ~ '^[A-Z0-9][A-Z0-9_-]{1,19}$'`),
  check("document_checklist_items_lead_days_check", sql`${table.defaultLeadDays} between 0 and 180`),
  check("document_checklist_items_status_check", sql`${table.status} in ('active', 'archived')`),
]);

export const documentRequests = pgTable("document_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  legalEntityId: uuid("legal_entity_id").notNull(),
  workItemId: uuid("work_item_id"),
  requestedByUserId: uuid("requested_by_user_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  dueDate: date("due_date", { mode: "string" }).notNull(),
  status: text("status").notNull().default("requested"),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("document_requests_tenant_status_due_idx").on(table.tenantId, table.status, table.dueDate),
  unique("document_requests_tenant_id_unique").on(table.tenantId, table.id),
  foreignKey({ name: "document_requests_entity_tenant_fk", columns: [table.tenantId, table.legalEntityId], foreignColumns: [legalEntities.tenantId, legalEntities.id] }),
  foreignKey({ name: "document_requests_work_tenant_fk", columns: [table.tenantId, table.workItemId], foreignColumns: [workItems.tenantId, workItems.id] }),
  foreignKey({ name: "document_requests_requester_membership_fk", columns: [table.tenantId, table.requestedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("document_requests_entity_idx").on(table.tenantId, table.legalEntityId),
  check("document_requests_status_check", sql`${table.status} in ('requested', 'received', 'cancelled')`),
  check("document_requests_received_state_check", sql`(${table.status} = 'received' and ${table.receivedAt} is not null) or (${table.status} <> 'received' and ${table.receivedAt} is null)`),
]);

export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  legalEntityId: uuid("legal_entity_id").notNull(),
  workItemId: uuid("work_item_id"),
  requestId: uuid("request_id"),
  uploadedByUserId: uuid("uploaded_by_user_id").notNull(),
  originalName: text("original_name").notNull(),
  storageName: text("storage_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("documents_tenant_storage_unique").on(table.tenantId, table.storageName),
  unique("documents_tenant_request_unique").on(table.tenantId, table.requestId),
  foreignKey({ name: "documents_entity_tenant_fk", columns: [table.tenantId, table.legalEntityId], foreignColumns: [legalEntities.tenantId, legalEntities.id] }),
  foreignKey({ name: "documents_work_tenant_fk", columns: [table.tenantId, table.workItemId], foreignColumns: [workItems.tenantId, workItems.id] }),
  foreignKey({ name: "documents_request_tenant_fk", columns: [table.tenantId, table.requestId], foreignColumns: [documentRequests.tenantId, documentRequests.id] }),
  foreignKey({ name: "documents_uploader_membership_fk", columns: [table.tenantId, table.uploadedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("documents_entity_idx").on(table.tenantId, table.legalEntityId, table.createdAt),
  index("documents_request_idx").on(table.tenantId, table.requestId),
  index("documents_tenant_created_idx").on(table.tenantId, table.createdAt),
  check("documents_size_check", sql`${table.sizeBytes} between 1 and 10485760`),
  check("documents_sha256_check", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
  check("documents_status_check", sql`${table.status} in ('pending', 'ready')`),
]);

/**
 * Employee payment instructions. Account numbers are needed in full to generate a
 * bank file, so they are stored — but they are masked everywhere they are shown,
 * never written to a log, and never fabricated by the seed.
 */
export const employeeBankAccounts = pgTable("employee_bank_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  employeeUserId: uuid("employee_user_id").notNull(),
  accountHolderName: text("account_holder_name").notNull(),
  accountNumber: text("account_number").notNull(),
  ifscCode: text("ifsc_code").notNull(),
  bankName: text("bank_name").notNull(),
  accountType: text("account_type").notNull().default("savings"),
  status: text("status").notNull().default("active"),
  recordedByUserId: uuid("recorded_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("employee_bank_accounts_tenant_id_unique").on(table.tenantId, table.id),
  uniqueIndex("employee_bank_accounts_active_unique").on(table.tenantId, table.employeeUserId).where(sql`${table.status} = 'active'`),
  foreignKey({ name: "employee_bank_accounts_employee_membership_fk", columns: [table.tenantId, table.employeeUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "employee_bank_accounts_recorder_membership_fk", columns: [table.tenantId, table.recordedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("employee_bank_accounts_employee_idx").on(table.tenantId, table.employeeUserId, table.status),
  check("employee_bank_accounts_holder_check", sql`length(trim(${table.accountHolderName})) between 2 and 120`),
  check("employee_bank_accounts_number_check", sql`${table.accountNumber} ~ '^[0-9]{5,20}$'`),
  check("employee_bank_accounts_ifsc_check", sql`${table.ifscCode} ~ '^[A-Z]{4}0[A-Z0-9]{6}$'`),
  check("employee_bank_accounts_bank_check", sql`length(trim(${table.bankName})) between 2 and 120`),
  check("employee_bank_accounts_type_check", sql`${table.accountType} in ('savings', 'current')`),
  check("employee_bank_accounts_status_check", sql`${table.status} in ('active', 'inactive')`),
]);

export const payrollDisbursements = pgTable("payroll_disbursements", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  payrollRunId: uuid("payroll_run_id").notNull(),
  batchReference: text("batch_reference").notNull(),
  paymentDate: date("payment_date", { mode: "string" }).notNull(),
  instructionCount: integer("instruction_count").notNull(),
  totalAmountPaise: bigint("total_amount_paise", { mode: "number" }).notNull(),
  excludedCount: integer("excluded_count").notNull().default(0),
  generatedByUserId: uuid("generated_by_user_id").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("payroll_disbursements_tenant_id_unique").on(table.tenantId, table.id),
  uniqueIndex("payroll_disbursements_batch_unique").on(table.tenantId, sql`upper(${table.batchReference})`),
  foreignKey({ name: "payroll_disbursements_run_tenant_fk", columns: [table.tenantId, table.payrollRunId], foreignColumns: [payrollRuns.tenantId, payrollRuns.id] }),
  foreignKey({ name: "payroll_disbursements_generator_membership_fk", columns: [table.tenantId, table.generatedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("payroll_disbursements_run_idx").on(table.tenantId, table.payrollRunId, table.generatedAt),
  check("payroll_disbursements_reference_check", sql`${table.batchReference} ~ '^[A-Z0-9-]{6,40}$'`),
  check("payroll_disbursements_counts_check", sql`${table.instructionCount} >= 0 and ${table.excludedCount} >= 0`),
  check("payroll_disbursements_total_check", sql`${table.totalAmountPaise} >= 0`),
]);

export const statutoryRateVersions = pgTable("statutory_rate_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  ruleType: text("rule_type").notNull(),
  jurisdiction: text("jurisdiction").notNull().default("IN"),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  status: text("status").notNull().default("active"),
  sourceReference: text("source_reference").notNull().default(""),
  notes: text("notes").notNull().default(""),
  recordedByUserId: uuid("recorded_by_user_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("statutory_rate_versions_tenant_id_unique").on(table.tenantId, table.id),
  uniqueIndex("statutory_rate_versions_scope_effective_unique").on(table.tenantId, sql`lower(${table.ruleType})`, sql`upper(${table.jurisdiction})`, table.effectiveFrom),
  foreignKey({ name: "statutory_rate_versions_recorder_membership_fk", columns: [table.tenantId, table.recordedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("statutory_rate_versions_lookup_idx").on(table.tenantId, table.ruleType, table.jurisdiction, table.status, table.effectiveFrom),
  check("statutory_rate_versions_type_check", sql`${table.ruleType} in ('epf', 'esi', 'professional_tax')`),
  check("statutory_rate_versions_jurisdiction_check", sql`${table.jurisdiction} ~ '^[A-Z]{2,10}$'`),
  check("statutory_rate_versions_status_check", sql`${table.status} in ('active', 'archived')`),
  check("statutory_rate_versions_source_check", sql`length(${table.sourceReference}) <= 200`),
  check("statutory_rate_versions_notes_check", sql`length(${table.notes}) <= 1000`),
]);

export const statutoryRateParameters = pgTable("statutory_rate_parameters", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  versionId: uuid("version_id").notNull(),
  parameterKey: text("parameter_key").notNull(),
  numericValue: bigint("numeric_value", { mode: "number" }).notNull(),
  unit: text("unit").notNull(),
}, (table) => [
  unique("statutory_rate_parameters_version_key_unique").on(table.tenantId, table.versionId, table.parameterKey),
  foreignKey({ name: "statutory_rate_parameters_version_tenant_fk", columns: [table.tenantId, table.versionId], foreignColumns: [statutoryRateVersions.tenantId, statutoryRateVersions.id] }),
  index("statutory_rate_parameters_version_idx").on(table.tenantId, table.versionId),
  check("statutory_rate_parameters_key_check", sql`${table.parameterKey} ~ '^[a-z][a-z0-9_]{1,60}$'`),
  check("statutory_rate_parameters_unit_check", sql`${table.unit} in ('basis_points', 'paise', 'count')`),
  check("statutory_rate_parameters_value_check", sql`${table.numericValue} >= 0`),
]);

export const filingAcknowledgements = pgTable("filing_acknowledgements", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  legalEntityId: uuid("legal_entity_id").notNull(),
  workItemId: uuid("work_item_id"),
  portal: text("portal").notNull(),
  filingType: text("filing_type").notNull(),
  periodKey: text("period_key").notNull(),
  acknowledgementNumber: text("acknowledgement_number").notNull(),
  filedOn: date("filed_on", { mode: "string" }).notNull(),
  portalStatus: text("portal_status").notNull(),
  source: text("source").notNull().default("manual"),
  remarks: text("remarks").notNull().default(""),
  recordedByUserId: uuid("recorded_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("filing_acknowledgements_tenant_id_unique").on(table.tenantId, table.id),
  uniqueIndex("filing_acknowledgements_tenant_reference_unique").on(table.tenantId, sql`upper(${table.acknowledgementNumber})`),
  foreignKey({ name: "filing_acknowledgements_entity_tenant_fk", columns: [table.tenantId, table.legalEntityId], foreignColumns: [legalEntities.tenantId, legalEntities.id] }),
  foreignKey({ name: "filing_acknowledgements_work_tenant_fk", columns: [table.tenantId, table.workItemId], foreignColumns: [workItems.tenantId, workItems.id] }),
  foreignKey({ name: "filing_acknowledgements_recorder_membership_fk", columns: [table.tenantId, table.recordedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("filing_acknowledgements_entity_period_idx").on(table.tenantId, table.legalEntityId, table.periodKey),
  check("filing_acknowledgements_portal_check", sql`${table.portal} in ('gstn', 'income_tax', 'traces', 'mca', 'other')`),
  check("filing_acknowledgements_type_check", sql`length(trim(${table.filingType})) between 2 and 40`),
  check("filing_acknowledgements_period_check", sql`length(trim(${table.periodKey})) between 2 and 60`),
  check("filing_acknowledgements_reference_check", sql`${table.acknowledgementNumber} ~ '^[A-Za-z0-9/-]{6,40}$'`),
  check("filing_acknowledgements_status_check", sql`${table.portalStatus} in ('filed', 'filed_late', 'processed', 'defective', 'rejected')`),
  check("filing_acknowledgements_source_check", sql`${table.source} in ('manual', 'api')`),
  check("filing_acknowledgements_remarks_check", sql`length(${table.remarks}) <= 1000`),
]);

export const udinRegistrations = pgTable("udin_registrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  legalEntityId: uuid("legal_entity_id").notNull(),
  workItemId: uuid("work_item_id"),
  udin: text("udin").notNull(),
  documentType: text("document_type").notNull(),
  documentDescription: text("document_description").notNull(),
  membershipNumber: text("membership_number").notNull(),
  signedByUserId: uuid("signed_by_user_id").notNull(),
  generatedOn: date("generated_on", { mode: "string" }).notNull(),
  status: text("status").notNull().default("active"),
  revocationReason: text("revocation_reason").notNull().default(""),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  recordedByUserId: uuid("recorded_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("udin_registrations_tenant_id_unique").on(table.tenantId, table.id),
  uniqueIndex("udin_registrations_tenant_udin_unique").on(table.tenantId, sql`upper(${table.udin})`),
  foreignKey({ name: "udin_registrations_entity_tenant_fk", columns: [table.tenantId, table.legalEntityId], foreignColumns: [legalEntities.tenantId, legalEntities.id] }),
  foreignKey({ name: "udin_registrations_work_tenant_fk", columns: [table.tenantId, table.workItemId], foreignColumns: [workItems.tenantId, workItems.id] }),
  foreignKey({ name: "udin_registrations_signer_membership_fk", columns: [table.tenantId, table.signedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "udin_registrations_recorder_membership_fk", columns: [table.tenantId, table.recordedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("udin_registrations_tenant_generated_idx").on(table.tenantId, table.generatedOn),
  check("udin_registrations_udin_check", sql`${table.udin} ~ '^[0-9]{8}[A-Za-z0-9]{10}$'`),
  check("udin_registrations_type_check", sql`${table.documentType} in ('tax_audit', 'statutory_audit', 'gst_audit', 'certificate', 'itr_filing', 'roc_filing', 'other')`),
  check("udin_registrations_description_check", sql`length(trim(${table.documentDescription})) between 2 and 200`),
  check("udin_registrations_membership_check", sql`${table.membershipNumber} ~ '^[0-9]{6}$'`),
  check("udin_registrations_status_check", sql`${table.status} in ('active', 'revoked')`),
  check("udin_registrations_revoked_state_check", sql`(${table.status} = 'revoked' and ${table.revokedAt} is not null and length(trim(${table.revocationReason})) > 0) or (${table.status} <> 'revoked' and ${table.revokedAt} is null and ${table.revocationReason} = '')`),
]);

export const dscCertificates = pgTable("dsc_certificates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  legalEntityId: uuid("legal_entity_id").notNull(),
  holderName: text("holder_name").notNull(),
  serialNumber: text("serial_number").notNull(),
  issuingAuthority: text("issuing_authority").notNull(),
  certificateClass: text("certificate_class").notNull().default("class_3"),
  validFrom: date("valid_from", { mode: "string" }).notNull(),
  validUntil: date("valid_until", { mode: "string" }).notNull(),
  status: text("status").notNull().default("in_custody"),
  custodianUserId: uuid("custodian_user_id"),
  storageLocation: text("storage_location").notNull().default(""),
  notes: text("notes").notNull().default(""),
  recordedByUserId: uuid("recorded_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("dsc_certificates_tenant_id_unique").on(table.tenantId, table.id),
  uniqueIndex("dsc_certificates_tenant_serial_unique").on(table.tenantId, sql`upper(${table.serialNumber})`),
  foreignKey({ name: "dsc_certificates_entity_tenant_fk", columns: [table.tenantId, table.legalEntityId], foreignColumns: [legalEntities.tenantId, legalEntities.id] }),
  foreignKey({ name: "dsc_certificates_custodian_membership_fk", columns: [table.tenantId, table.custodianUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "dsc_certificates_recorder_membership_fk", columns: [table.tenantId, table.recordedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("dsc_certificates_tenant_expiry_idx").on(table.tenantId, table.status, table.validUntil),
  check("dsc_certificates_holder_check", sql`length(trim(${table.holderName})) between 2 and 120`),
  check("dsc_certificates_serial_check", sql`${table.serialNumber} ~ '^[A-Za-z0-9:_-]{4,64}$'`),
  check("dsc_certificates_authority_check", sql`length(trim(${table.issuingAuthority})) between 2 and 120`),
  check("dsc_certificates_class_check", sql`${table.certificateClass} in ('class_2', 'class_3', 'dgft')`),
  check("dsc_certificates_validity_check", sql`${table.validUntil} >= ${table.validFrom}`),
  check("dsc_certificates_status_check", sql`${table.status} in ('in_custody', 'issued_out', 'returned', 'expired', 'surrendered')`),
  check("dsc_certificates_custody_check", sql`${table.status} <> 'in_custody' or ${table.custodianUserId} is not null`),
  check("dsc_certificates_location_check", sql`length(${table.storageLocation}) <= 160`),
  check("dsc_certificates_notes_check", sql`length(${table.notes}) <= 1000`),
]);

export const dscCustodyEvents = pgTable("dsc_custody_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  dscId: uuid("dsc_id").notNull(),
  eventType: text("event_type").notNull(),
  custodianUserId: uuid("custodian_user_id"),
  counterpartyName: text("counterparty_name").notNull().default(""),
  remarks: text("remarks").notNull().default(""),
  // Null when a scheduled job records the transition rather than a person.
  recordedByUserId: uuid("recorded_by_user_id"),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: "dsc_custody_events_dsc_tenant_fk", columns: [table.tenantId, table.dscId], foreignColumns: [dscCertificates.tenantId, dscCertificates.id] }),
  foreignKey({ name: "dsc_custody_events_custodian_membership_fk", columns: [table.tenantId, table.custodianUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "dsc_custody_events_recorder_membership_fk", columns: [table.tenantId, table.recordedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("dsc_custody_events_dsc_idx").on(table.tenantId, table.dscId, table.occurredAt),
  check("dsc_custody_events_type_check", sql`${table.eventType} in ('received', 'issued_out', 'returned', 'surrendered', 'expired')`),
  check("dsc_custody_events_counterparty_check", sql`length(${table.counterpartyName}) <= 120`),
  check("dsc_custody_events_remarks_check", sql`length(${table.remarks}) <= 500`),
]);

export const statutoryNotices = pgTable("statutory_notices", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  legalEntityId: uuid("legal_entity_id").notNull(),
  workItemId: uuid("work_item_id"),
  authority: text("authority").notNull(),
  noticeNumber: text("notice_number").notNull(),
  noticeSection: text("notice_section").notNull().default(""),
  subject: text("subject").notNull(),
  noticeDate: date("notice_date", { mode: "string" }).notNull(),
  receivedDate: date("received_date", { mode: "string" }).notNull(),
  responseDueDate: date("response_due_date", { mode: "string" }).notNull(),
  assigneeId: uuid("assignee_id"),
  status: text("status").notNull().default("open"),
  respondedOn: date("responded_on", { mode: "string" }),
  responseSummary: text("response_summary").notNull().default(""),
  recordedByUserId: uuid("recorded_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("statutory_notices_tenant_id_unique").on(table.tenantId, table.id),
  unique("statutory_notices_tenant_entity_number_unique").on(table.tenantId, table.legalEntityId, table.noticeNumber),
  foreignKey({ name: "statutory_notices_entity_tenant_fk", columns: [table.tenantId, table.legalEntityId], foreignColumns: [legalEntities.tenantId, legalEntities.id] }),
  foreignKey({ name: "statutory_notices_work_tenant_fk", columns: [table.tenantId, table.workItemId], foreignColumns: [workItems.tenantId, workItems.id] }),
  foreignKey({ name: "statutory_notices_assignee_membership_fk", columns: [table.tenantId, table.assigneeId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "statutory_notices_recorder_membership_fk", columns: [table.tenantId, table.recordedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("statutory_notices_tenant_status_due_idx").on(table.tenantId, table.status, table.responseDueDate),
  check("statutory_notices_authority_check", sql`${table.authority} in ('income_tax', 'gst', 'tds', 'roc', 'other')`),
  check("statutory_notices_number_check", sql`length(trim(${table.noticeNumber})) between 2 and 80`),
  check("statutory_notices_section_check", sql`length(${table.noticeSection}) <= 60`),
  check("statutory_notices_subject_check", sql`length(trim(${table.subject})) between 2 and 200`),
  check("statutory_notices_summary_check", sql`length(${table.responseSummary}) <= 2000`),
  check("statutory_notices_status_check", sql`${table.status} in ('open', 'in_progress', 'responded', 'closed')`),
  check("statutory_notices_date_order_check", sql`${table.receivedDate} >= ${table.noticeDate} and ${table.responseDueDate} >= ${table.receivedDate}`),
  check("statutory_notices_responded_state_check", sql`(${table.status} in ('responded', 'closed') and ${table.respondedOn} is not null) or (${table.status} in ('open', 'in_progress') and ${table.respondedOn} is null)`),
]);

/**
 * What an hour of somebody's time is worth, and what it costs.
 *
 * Effective-dated rather than mutable, because a rate revision must not rewrite
 * what last quarter's work was worth. The row in force is the latest one whose
 * `effectiveFrom` has passed, which is the same shape attendance policies and
 * salary structures already use.
 *
 * `costPaisePerHour` is only a fallback. Cost is normally derived from the
 * salary structure already on file — one truth that moves when pay moves —
 * and this covers the people who have no structure, partners most of all.
 */
export const employeeRates = pgTable("employee_rates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  employeeUserId: uuid("employee_user_id").notNull(),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  chargePaisePerHour: bigint("charge_paise_per_hour", { mode: "number" }).notNull(),
  costPaisePerHour: bigint("cost_paise_per_hour", { mode: "number" }),
  note: text("note").notNull().default(""),
  createdByUserId: uuid("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("employee_rates_tenant_id_unique").on(table.tenantId, table.id),
  unique("employee_rates_employee_effective_unique").on(table.tenantId, table.employeeUserId, table.effectiveFrom),
  foreignKey({ name: "employee_rates_employee_membership_fk", columns: [table.tenantId, table.employeeUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "employee_rates_creator_membership_fk", columns: [table.tenantId, table.createdByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("employee_rates_lookup_idx").on(table.tenantId, table.employeeUserId, table.effectiveFrom),
  // A crore an hour is a typo, not a rate. Zero is legitimate: pro bono work is
  // still worth recording the effort on.
  check("employee_rates_charge_check", sql`${table.chargePaisePerHour} between 0 and 100000000`),
  check("employee_rates_cost_check", sql`${table.costPaisePerHour} is null or ${table.costPaisePerHour} between 0 and 100000000`),
  check("employee_rates_note_check", sql`length(${table.note}) <= 300`),
]);

/**
 * A rate this client negotiated, for this person.
 *
 * Firms quote a house rate card and then agree exceptions; without somewhere to
 * put the exception it lives in an email, and the invoice is built by hand.
 */
export const clientRateOverrides = pgTable("client_rate_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  legalEntityId: uuid("legal_entity_id").notNull(),
  employeeUserId: uuid("employee_user_id").notNull(),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  chargePaisePerHour: bigint("charge_paise_per_hour", { mode: "number" }).notNull(),
  note: text("note").notNull().default(""),
  createdByUserId: uuid("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("client_rate_overrides_tenant_id_unique").on(table.tenantId, table.id),
  unique("client_rate_overrides_scope_effective_unique").on(table.tenantId, table.legalEntityId, table.employeeUserId, table.effectiveFrom),
  foreignKey({ name: "client_rate_overrides_entity_tenant_fk", columns: [table.tenantId, table.legalEntityId], foreignColumns: [legalEntities.tenantId, legalEntities.id] }),
  foreignKey({ name: "client_rate_overrides_employee_membership_fk", columns: [table.tenantId, table.employeeUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "client_rate_overrides_creator_membership_fk", columns: [table.tenantId, table.createdByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("client_rate_overrides_lookup_idx").on(table.tenantId, table.legalEntityId, table.employeeUserId, table.effectiveFrom),
  check("client_rate_overrides_charge_check", sql`${table.chargePaisePerHour} between 0 and 100000000`),
  check("client_rate_overrides_note_check", sql`length(${table.note}) <= 300`),
]);

/**
 * How much of somebody's available time the firm expects to sell.
 *
 * Set per role, because a partner and an associate are not managed to the same
 * number, and overridden per person where somebody's job is genuinely different.
 * Effective-dated like every other commercial term here, so raising a target
 * next quarter does not retrospectively make last quarter a failure.
 *
 * Stored in basis points: 8000 is 80%. Percentages invite floats, and a target
 * that drifts is a target nobody trusts.
 */
export const utilisationTargets = pgTable("utilisation_targets", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  scope: text("scope").notNull(),
  /** Set when `scope` is `role`; one of the firm's four role keys. */
  roleKey: text("role_key"),
  /** Set when `scope` is `employee`; this person only. */
  employeeUserId: uuid("employee_user_id"),
  targetBasisPoints: integer("target_basis_points").notNull(),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  note: text("note").notNull().default(""),
  createdByUserId: uuid("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("utilisation_targets_tenant_id_unique").on(table.tenantId, table.id),
  // Two partial keys rather than one over nullable columns: in Postgres a NULL
  // never equals a NULL, so a single key would let duplicates straight through.
  uniqueIndex("utilisation_targets_role_unique").on(table.tenantId, table.roleKey, table.effectiveFrom).where(sql`${table.scope} = 'role'`),
  uniqueIndex("utilisation_targets_employee_unique").on(table.tenantId, table.employeeUserId, table.effectiveFrom).where(sql`${table.scope} = 'employee'`),
  foreignKey({ name: "utilisation_targets_employee_membership_fk", columns: [table.tenantId, table.employeeUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "utilisation_targets_creator_membership_fk", columns: [table.tenantId, table.createdByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("utilisation_targets_lookup_idx").on(table.tenantId, table.scope, table.effectiveFrom),
  check("utilisation_targets_scope_check", sql`${table.scope} in ('role', 'employee')`),
  // A target must say who it is for, and only one of the two ways.
  check("utilisation_targets_subject_check", sql`(${table.scope} = 'role' and ${table.roleKey} is not null and ${table.employeeUserId} is null) or (${table.scope} = 'employee' and ${table.employeeUserId} is not null and ${table.roleKey} is null)`),
  check("utilisation_targets_role_value_check", sql`${table.roleKey} is null or ${table.roleKey} in ('firm_administrator', 'partner', 'manager', 'associate')`),
  // Zero is a legitimate target for somebody who is not meant to sell time.
  check("utilisation_targets_value_check", sql`${table.targetBasisPoints} between 0 and 10000`),
  check("utilisation_targets_note_check", sql`length(${table.note}) <= 300`),
]);

export const timeEntries = pgTable("time_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  employeeUserId: uuid("employee_user_id").notNull(),
  entryDate: date("entry_date", { mode: "string" }).notNull(),
  minutes: integer("minutes").notNull(),
  legalEntityId: uuid("legal_entity_id"),
  workItemId: uuid("work_item_id"),
  officeTaskId: uuid("office_task_id"),
  billable: boolean("billable").notNull().default(true),
  narration: text("narration").notNull(),
  /**
   * Who actually typed it. Usually the employee themselves; a manager where the
   * entry fell outside the back-dating window, which is the only way such an
   * entry can be made at all.
   */
  recordedByUserId: uuid("recorded_by_user_id"),
  /** Why an entry outside the window was allowed. Required when it was. */
  backdateReason: text("backdate_reason").notNull().default(""),
  /**
   * The invoice line that consumed this entry, or null while it is unbilled.
   * Claimed when a draft is raised rather than when it is issued, so two drafts
   * cannot quietly bill the same hours.
   */
  invoiceLineId: uuid("invoice_line_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("time_entries_tenant_id_unique").on(table.tenantId, table.id),
  foreignKey({ name: "time_entries_recorder_membership_fk", columns: [table.tenantId, table.recordedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  check("time_entries_backdate_reason_check", sql`length(${table.backdateReason}) <= 500`),
  foreignKey({ name: "time_entries_invoice_line_tenant_fk", columns: [table.tenantId, table.invoiceLineId], foreignColumns: [invoiceLines.tenantId, invoiceLines.id] }),
  index("time_entries_unbilled_idx").on(table.tenantId, table.legalEntityId, table.invoiceLineId),
  foreignKey({ name: "time_entries_employee_membership_fk", columns: [table.tenantId, table.employeeUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "time_entries_entity_tenant_fk", columns: [table.tenantId, table.legalEntityId], foreignColumns: [legalEntities.tenantId, legalEntities.id] }),
  foreignKey({ name: "time_entries_work_tenant_fk", columns: [table.tenantId, table.workItemId], foreignColumns: [workItems.tenantId, workItems.id] }),
  foreignKey({ name: "time_entries_task_tenant_fk", columns: [table.tenantId, table.officeTaskId], foreignColumns: [officeTasks.tenantId, officeTasks.id] }),
  index("time_entries_employee_date_idx").on(table.tenantId, table.employeeUserId, table.entryDate),
  index("time_entries_entity_date_idx").on(table.tenantId, table.legalEntityId, table.entryDate),
  index("time_entries_work_idx").on(table.tenantId, table.workItemId),
  index("time_entries_task_idx").on(table.tenantId, table.officeTaskId),
  check("time_entries_minutes_check", sql`${table.minutes} between 1 and 1440`),
  check("time_entries_narration_check", sql`length(trim(${table.narration})) between 2 and 500`),
  check("time_entries_billable_scope_check", sql`${table.billable} = false or ${table.legalEntityId} is not null`),
]);

/**
 * How the firm governs the time its people record.
 *
 * Time was collected and nothing else: an entry could be created for any date,
 * edited for ever, and deleted by the person who made it. Nobody approved a
 * month, nothing froze once an invoice had been raised against it, and a figure
 * quoted to a client on Tuesday could be a different figure on Friday.
 *
 * Effective-dated because a firm tightening its back-dating window in April has
 * not retrospectively made March's entries irregular.
 */
export const timesheetPolicies = pgTable("timesheet_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  effectiveFrom: date("effective_from", { mode: "string" }).notNull(),
  /**
   * How many days back a person may record their own time. Beyond it, only a
   * manager may, and only with a reason — because late entry does happen, and
   * an exception that cannot be recorded is taken anyway and leaves the
   * register looking as though nothing was ever late.
   */
  backdateWindowDays: integer("backdate_window_days").notNull().default(14),
  /** Whether time may be recorded against a date that has not happened yet. */
  allowFutureDates: boolean("allow_future_dates").notNull().default(false),
  /** Minutes a full month is expected to hold, for the completeness figure. */
  expectedMonthlyMinutes: integer("expected_monthly_minutes"),
  createdByUserId: uuid("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("timesheet_policies_tenant_effective_unique").on(table.tenantId, table.effectiveFrom),
  unique("timesheet_policies_tenant_id_unique").on(table.tenantId, table.id),
  foreignKey({ name: "timesheet_policies_creator_membership_fk", columns: [table.tenantId, table.createdByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("timesheet_policies_tenant_effective_idx").on(table.tenantId, table.effectiveFrom),
  check("timesheet_policies_effective_month_check", sql`extract(day from ${table.effectiveFrom}) = 1`),
  check("timesheet_policies_window_check", sql`${table.backdateWindowDays} between 0 and 365`),
  check("timesheet_policies_expected_check", sql`${table.expectedMonthlyMinutes} is null or ${table.expectedMonthlyMinutes} between 60 and 30000`),
]);

/**
 * One person's month of time, and what has become of it.
 *
 * `open` → `submitted` → `approved`, or back to `open` when returned. Approving
 * freezes the entries: after that the month is a statement the firm has made,
 * not a working note. Reopening is possible and is recorded, because a genuine
 * correction must not require somebody to lie about the original.
 */
export const timesheetPeriods = pgTable("timesheet_periods", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  employeeUserId: uuid("employee_user_id").notNull(),
  /** `YYYY-MM`, matching the attendance period key. */
  periodKey: text("period_key").notNull(),
  status: text("status").notNull().default("open"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }),
  /** What the month totalled when it was submitted. A later edit is visible. */
  submittedMinutes: integer("submitted_minutes"),
  decidedByUserId: uuid("decided_by_user_id"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note").notNull().default(""),
  reopenedByUserId: uuid("reopened_by_user_id"),
  reopenedAt: timestamp("reopened_at", { withTimezone: true }),
  reopenReason: text("reopen_reason").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("timesheet_periods_tenant_id_unique").on(table.tenantId, table.id),
  unique("timesheet_periods_employee_period_unique").on(table.tenantId, table.employeeUserId, table.periodKey),
  foreignKey({ name: "timesheet_periods_employee_membership_fk", columns: [table.tenantId, table.employeeUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "timesheet_periods_decider_membership_fk", columns: [table.tenantId, table.decidedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "timesheet_periods_reopener_membership_fk", columns: [table.tenantId, table.reopenedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("timesheet_periods_status_idx").on(table.tenantId, table.status, table.periodKey),
  index("timesheet_periods_period_idx").on(table.tenantId, table.periodKey),
  check("timesheet_periods_period_check", sql`${table.periodKey} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
  check("timesheet_periods_status_check", sql`${table.status} in ('open', 'submitted', 'approved')`),
  // A submitted month has a submission; an approved one has a decision as well.
  check("timesheet_periods_state_check", sql`
    (${table.status} = 'open' and ${table.decidedAt} is null)
    or (${table.status} = 'submitted' and ${table.submittedAt} is not null and ${table.decidedAt} is null)
    or (${table.status} = 'approved' and ${table.submittedAt} is not null and ${table.decidedAt} is not null and ${table.decidedByUserId} is not null)
  `),
  // Nobody approves their own month. This is the control, not the status.
  check("timesheet_periods_self_approval_check", sql`${table.decidedByUserId} is null or ${table.decidedByUserId} <> ${table.employeeUserId}`),
  check("timesheet_periods_reopen_pair_check", sql`(${table.reopenedAt} is null and ${table.reopenedByUserId} is null) or (${table.reopenedAt} is not null and ${table.reopenedByUserId} is not null and length(trim(${table.reopenReason})) > 0)`),
  check("timesheet_periods_note_check", sql`length(${table.decisionNote}) <= 500 and length(${table.reopenReason}) <= 500`),
  check("timesheet_periods_submitted_minutes_check", sql`${table.submittedMinutes} is null or ${table.submittedMinutes} >= 0`),
]);

export const clientPortalUsers = pgTable("client_portal_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  legalEntityId: uuid("legal_entity_id").notNull(),
  email: text("email").notNull(),
  fullName: text("full_name").notNull(),
  status: text("status").notNull().default("invited"),
  createdByUserId: uuid("created_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("client_portal_users_tenant_id_unique").on(table.tenantId, table.id),
  uniqueIndex("client_portal_users_tenant_email_lower_unique").on(table.tenantId, sql`lower(${table.email})`),
  foreignKey({ name: "client_portal_users_entity_tenant_fk", columns: [table.tenantId, table.legalEntityId], foreignColumns: [legalEntities.tenantId, legalEntities.id] }),
  foreignKey({ name: "client_portal_users_creator_membership_fk", columns: [table.tenantId, table.createdByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("client_portal_users_entity_idx").on(table.tenantId, table.legalEntityId, table.status),
  check("client_portal_users_email_check", sql`${table.email} ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and length(${table.email}) <= 254`),
  check("client_portal_users_full_name_check", sql`length(trim(${table.fullName})) between 2 and 120`),
  check("client_portal_users_status_check", sql`${table.status} in ('invited', 'active', 'disabled')`),
]);

export const clientPortalCredentials = pgTable("client_portal_credentials", {
  portalUserId: uuid("portal_user_id").primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  passwordHash: text("password_hash").notNull(),
  failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  mustChangePassword: boolean("must_change_password").notNull().default(true),
  passwordChangedAt: timestamp("password_changed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({ name: "client_portal_credentials_user_tenant_fk", columns: [table.tenantId, table.portalUserId], foreignColumns: [clientPortalUsers.tenantId, clientPortalUsers.id] }),
  check("client_portal_credentials_failed_attempts_check", sql`${table.failedLoginAttempts} >= 0`),
]);

export const clientPortalSessions = pgTable("client_portal_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  portalUserId: uuid("portal_user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("client_portal_sessions_token_hash_unique").on(table.tokenHash),
  foreignKey({ name: "client_portal_sessions_user_tenant_fk", columns: [table.tenantId, table.portalUserId], foreignColumns: [clientPortalUsers.tenantId, clientPortalUsers.id] }),
  index("client_portal_sessions_user_idx").on(table.tenantId, table.portalUserId),
  index("client_portal_sessions_expiry_idx").on(table.expiresAt),
]);

export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  legalEntityId: uuid("legal_entity_id").notNull(),
  assignmentId: uuid("assignment_id"),
  invoiceSeq: integer("invoice_seq").notNull(),
  invoiceNumber: text("invoice_number").notNull(),
  periodLabel: text("period_label").notNull(),
  notes: text("notes").notNull().default(""),
  status: text("status").notNull().default("draft"),
  subtotalPaise: bigint("subtotal_paise", { mode: "number" }).notNull(),
  taxPaise: bigint("tax_paise", { mode: "number" }).notNull().default(0),
  totalPaise: bigint("total_paise", { mode: "number" }).notNull(),
  /**
   * The parties and the place, snapshotted at issue.
   *
   * A GSTIN read live would rewrite last year's invoice when a client
   * re-registers, and a tax invoice is a statement about the day it was issued.
   */
  supplierGstin: text("supplier_gstin"),
  supplierStateCode: text("supplier_state_code"),
  recipientGstin: text("recipient_gstin"),
  recipientStateCode: text("recipient_state_code"),
  /** The state where the supply is treated as made. Decides the tax split. */
  placeOfSupplyCode: text("place_of_supply_code"),
  supplyType: text("supply_type").notNull().default("intra_state"),
  /** Set where the recipient pays the tax instead of the firm. */
  reverseCharge: boolean("reverse_charge").notNull().default(false),
  cgstPaise: bigint("cgst_paise", { mode: "number" }).notNull().default(0),
  sgstPaise: bigint("sgst_paise", { mode: "number" }).notNull().default(0),
  igstPaise: bigint("igst_paise", { mode: "number" }).notNull().default(0),
  issueDate: date("issue_date", { mode: "string" }),
  dueDate: date("due_date", { mode: "string" }),
  paymentReference: text("payment_reference").notNull().default(""),
  cancellationReason: text("cancellation_reason").notNull().default(""),
  createdByUserId: uuid("created_by_user_id").notNull(),
  issuedByUserId: uuid("issued_by_user_id"),
  paymentRecordedByUserId: uuid("payment_recorded_by_user_id"),
  issuedAt: timestamp("issued_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("invoices_tenant_id_unique").on(table.tenantId, table.id),
  unique("invoices_tenant_seq_unique").on(table.tenantId, table.invoiceSeq),
  uniqueIndex("invoices_tenant_number_lower_unique").on(table.tenantId, sql`lower(${table.invoiceNumber})`),
  foreignKey({ name: "invoices_entity_tenant_fk", columns: [table.tenantId, table.legalEntityId], foreignColumns: [legalEntities.tenantId, legalEntities.id] }),
  foreignKey({ name: "invoices_assignment_tenant_fk", columns: [table.tenantId, table.assignmentId], foreignColumns: [clientPackageAssignments.tenantId, clientPackageAssignments.id] }),
  foreignKey({ name: "invoices_creator_membership_fk", columns: [table.tenantId, table.createdByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "invoices_issuer_membership_fk", columns: [table.tenantId, table.issuedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  foreignKey({ name: "invoices_payment_recorder_membership_fk", columns: [table.tenantId, table.paymentRecordedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("invoices_tenant_status_due_idx").on(table.tenantId, table.status, table.dueDate),
  index("invoices_tenant_entity_idx").on(table.tenantId, table.legalEntityId, table.createdAt),
  check("invoices_seq_check", sql`${table.invoiceSeq} > 0`),
  check("invoices_number_check", sql`length(trim(${table.invoiceNumber})) between 3 and 40`),
  check("invoices_period_check", sql`length(trim(${table.periodLabel})) between 2 and 60`),
  check("invoices_notes_check", sql`length(${table.notes}) <= 2000`),
  check("invoices_status_check", sql`${table.status} in ('draft', 'issued', 'part_paid', 'paid', 'cancelled')`),
  check("invoices_amounts_check", sql`${table.subtotalPaise} >= 0 and ${table.taxPaise} >= 0 and ${table.totalPaise} = ${table.subtotalPaise} + ${table.taxPaise}`),
  check("invoices_supply_type_check", sql`${table.supplyType} in ('intra_state', 'inter_state', 'export', 'exempt')`),
  check("invoices_gst_component_check", sql`${table.cgstPaise} >= 0 and ${table.sgstPaise} >= 0 and ${table.igstPaise} >= 0 and ${table.cgstPaise} + ${table.sgstPaise} + ${table.igstPaise} = ${table.taxPaise}`),
  // A supply within one state is CGST and SGST; one that crosses a state line is
  // IGST. An invoice carrying both has been split against the wrong place.
  check("invoices_gst_split_check", sql`
    (${table.supplyType} = 'intra_state' and ${table.igstPaise} = 0 and ${table.cgstPaise} = ${table.sgstPaise})
    or (${table.supplyType} = 'inter_state' and ${table.cgstPaise} = 0 and ${table.sgstPaise} = 0)
    or (${table.supplyType} in ('export', 'exempt') and ${table.taxPaise} = 0)
  `),
  // Under reverse charge the recipient pays the tax, so the invoice charges none.
  check("invoices_reverse_charge_check", sql`${table.reverseCharge} = false or ${table.taxPaise} = 0`),
  check("invoices_gstin_format_check", sql`
    (${table.supplierGstin} is null or ${table.supplierGstin} ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$')
    and (${table.recipientGstin} is null or ${table.recipientGstin} ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$')
  `),
  check("invoices_state_code_format_check", sql`
    (${table.supplierStateCode} is null or ${table.supplierStateCode} ~ '^[0-9]{2}$')
    and (${table.recipientStateCode} is null or ${table.recipientStateCode} ~ '^[0-9]{2}$')
    and (${table.placeOfSupplyCode} is null or ${table.placeOfSupplyCode} ~ '^[0-9]{2}$')
  `),
  // An issued invoice is a document somebody files from. It must know who
  // supplied it and where the supply landed.
  check("invoices_issued_tax_identity_check", sql`
    ${table.status} not in ('issued', 'part_paid', 'paid') or (${table.supplierStateCode} is not null and ${table.placeOfSupplyCode} is not null)
  `),
  check("invoices_issued_state_check", sql`(${table.status} in ('issued', 'part_paid', 'paid') and ${table.issuedAt} is not null and ${table.issuedByUserId} is not null and ${table.issueDate} is not null and ${table.dueDate} is not null) or (${table.status} in ('draft', 'cancelled') and (${table.status} = 'cancelled' or ${table.issuedAt} is null))`),
  check("invoices_due_after_issue_check", sql`${table.issueDate} is null or ${table.dueDate} is null or ${table.dueDate} >= ${table.issueDate}`),
  check("invoices_paid_state_check", sql`(${table.status} = 'paid' and ${table.paidAt} is not null and ${table.paymentRecordedByUserId} is not null) or (${table.status} <> 'paid' and ${table.paidAt} is null and ${table.paymentRecordedByUserId} is null)`),
  check("invoices_cancelled_state_check", sql`(${table.status} = 'cancelled' and ${table.cancelledAt} is not null and length(trim(${table.cancellationReason})) > 0) or (${table.status} <> 'cancelled' and ${table.cancelledAt} is null and ${table.cancellationReason} = '')`),
]);

export const invoiceLines = pgTable("invoice_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  invoiceId: uuid("invoice_id").notNull(),
  lineType: text("line_type").notNull(),
  description: text("description").notNull(),
  amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
  /**
   * What the time behind this line was worth at the rates in force. Null on a
   * line that is not made of time. Kept beside what was actually charged so the
   * difference is a number rather than a feeling at year end.
   */
  valuePaise: bigint("value_paise", { mode: "number" }),
  minutes: integer("minutes"),
  /** Why the charge departs from the value. Required when it materially does. */
  writeOffReason: text("write_off_reason").notNull().default(""),
  /** The obligation this line is for, where it is for one. */
  workItemId: uuid("work_item_id"),
  /** The SAC this line is supplied under, snapshotted from the service. */
  sacCode: text("sac_code"),
  /** Basis points, so 18% is 1800 and nothing is ever a float. */
  taxRateBp: integer("tax_rate_bp").notNull().default(0),
  cgstPaise: bigint("cgst_paise", { mode: "number" }).notNull().default(0),
  sgstPaise: bigint("sgst_paise", { mode: "number" }).notNull().default(0),
  igstPaise: bigint("igst_paise", { mode: "number" }).notNull().default(0),
  position: integer("position").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("invoice_lines_invoice_position_unique").on(table.tenantId, table.invoiceId, table.position),
  // Needed so a time entry can point back at its line without leaving the tenant.
  unique("invoice_lines_tenant_id_unique").on(table.tenantId, table.id),
  foreignKey({ name: "invoice_lines_invoice_tenant_fk", columns: [table.tenantId, table.invoiceId], foreignColumns: [invoices.tenantId, invoices.id] }),
  index("invoice_lines_invoice_idx").on(table.tenantId, table.invoiceId),
  foreignKey({ name: "invoice_lines_work_tenant_fk", columns: [table.tenantId, table.workItemId], foreignColumns: [workItems.tenantId, workItems.id] }),
  check("invoice_lines_type_check", sql`${table.lineType} in ('package_fee', 'addon', 'service', 'adjustment', 'time')`),
  // A time line carries the time it is made of; anything else carries neither,
  // so a value beside a package fee cannot be mistaken for measured effort.
  check("invoice_lines_time_pair_check", sql`
    (${table.lineType} = 'time' and ${table.valuePaise} is not null and ${table.minutes} is not null and ${table.minutes} > 0)
    or (${table.lineType} <> 'time' and ${table.valuePaise} is null and ${table.minutes} is null)
  `),
  // A departure from value beyond 1%, or a hundred rupees, has to say why.
  // Rounding a line to a whole figure is not a write-down and is not nagged.
  check("invoice_lines_write_off_check", sql`
    ${table.valuePaise} is null
    or abs(${table.amountPaise} - ${table.valuePaise}) <= greatest(10000, ${table.valuePaise} / 100)
    or length(trim(${table.writeOffReason})) > 0
  `),
  check("invoice_lines_write_off_length_check", sql`length(${table.writeOffReason}) <= 500`),
  check("invoice_lines_description_check", sql`length(trim(${table.description})) between 1 and 200`),
  check("invoice_lines_amount_check", sql`${table.amountPaise} >= 0`),
  check("invoice_lines_sac_check", sql`${table.sacCode} is null or ${table.sacCode} ~ '^[0-9]{4,8}$'`),
  // The rates GST actually has. A rate nobody can file under is a typo.
  check("invoice_lines_tax_rate_check", sql`${table.taxRateBp} in (0, 50, 100, 300, 500, 1200, 1800, 2800)`),
  check("invoice_lines_gst_component_check", sql`${table.cgstPaise} >= 0 and ${table.sgstPaise} >= 0 and ${table.igstPaise} >= 0`),
  check("invoice_lines_position_check", sql`${table.position} between 1 and 50`),
]);

/**
 * Money actually received against an invoice, and the tax withheld from it.
 *
 * An invoice was paid or it was not: one flag, one date, one reference. A client
 * who paid half in January and the rest in March could not be recorded until the
 * last rupee arrived, and the invoice showed as wholly unpaid throughout.
 *
 * Worse, a company paying a firm for professional services deducts tax at source
 * under section 194J and remits it to the government. The firm receives ninety
 * per cent and holds a credit for the rest. There was nowhere to say so, so
 * every such invoice was either short-paid for ever or marked paid for an amount
 * that never arrived.
 */
export const invoiceReceipts = pgTable("invoice_receipts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  invoiceId: uuid("invoice_id").notNull(),
  receivedOn: date("received_on", { mode: "string" }).notNull(),
  /** What actually reached the bank. */
  amountPaise: bigint("amount_paise", { mode: "number" }).notNull(),
  /**
   * Tax the client withheld under section 194J. Not money the firm lost — a
   * credit it claims, which is why it settles the invoice alongside the cash.
   */
  tdsPaise: bigint("tds_paise", { mode: "number" }).notNull().default(0),
  /** Basis points. 10% is the ordinary 194J rate for professional fees. */
  tdsRateBp: integer("tds_rate_bp").notNull().default(0),
  tdsSection: text("tds_section").notNull().default(""),
  instrument: text("instrument").notNull().default("neft"),
  reference: text("reference").notNull().default(""),
  note: text("note").notNull().default(""),
  recordedByUserId: uuid("recorded_by_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("invoice_receipts_tenant_id_unique").on(table.tenantId, table.id),
  foreignKey({ name: "invoice_receipts_invoice_tenant_fk", columns: [table.tenantId, table.invoiceId], foreignColumns: [invoices.tenantId, invoices.id] }),
  foreignKey({ name: "invoice_receipts_recorder_membership_fk", columns: [table.tenantId, table.recordedByUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("invoice_receipts_invoice_idx").on(table.tenantId, table.invoiceId, table.receivedOn),
  index("invoice_receipts_date_idx").on(table.tenantId, table.receivedOn),
  // A receipt that brings in nothing at all is not a receipt.
  check("invoice_receipts_amount_check", sql`${table.amountPaise} >= 0 and ${table.tdsPaise} >= 0 and ${table.amountPaise} + ${table.tdsPaise} > 0`),
  check("invoice_receipts_tds_rate_check", sql`${table.tdsRateBp} between 0 and 3000`),
  // TDS withheld means a section it was withheld under, and a section named
  // means something was withheld. Neither is meaningful alone.
  check("invoice_receipts_tds_pair_check", sql`
    (${table.tdsPaise} = 0 and ${table.tdsRateBp} = 0 and ${table.tdsSection} = '')
    or (${table.tdsPaise} > 0 and ${table.tdsRateBp} > 0 and length(trim(${table.tdsSection})) > 0)
  `),
  check("invoice_receipts_section_check", sql`${table.tdsSection} in ('', '194J', '194C', '194H', '194Q', '206C')`),
  check("invoice_receipts_instrument_check", sql`${table.instrument} in ('neft', 'rtgs', 'imps', 'upi', 'cheque', 'cash', 'adjustment')`),
  check("invoice_receipts_text_check", sql`length(${table.reference}) <= 120 and length(${table.note}) <= 500`),
]);

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  recipientUserId: uuid("recipient_user_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  resourceType: text("resource_type").notNull().default(""),
  resourceId: uuid("resource_id"),
  dedupeKey: text("dedupe_key"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("notifications_tenant_id_unique").on(table.tenantId, table.id),
  uniqueIndex("notifications_tenant_dedupe_unique").on(table.tenantId, table.dedupeKey).where(sql`${table.dedupeKey} is not null`),
  foreignKey({ name: "notifications_recipient_membership_fk", columns: [table.tenantId, table.recipientUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
  index("notifications_recipient_unread_idx").on(table.tenantId, table.recipientUserId, table.readAt, table.createdAt),
  check("notifications_type_check", sql`${table.type} in ('work_item_due', 'work_item_overdue', 'document_request_overdue', 'task_assigned', 'attendance_request_raised', 'attendance_request_decided', 'payslip_published', 'invoice_overdue', 'dsc_expiring', 'notice_due', 'work_dependency_cleared', 'work_dependency_overdue', 'work_item_escalated')`),
  check("notifications_title_check", sql`length(trim(${table.title})) between 1 and 200`),
  check("notifications_body_check", sql`length(${table.body}) <= 2000`),
  check("notifications_resource_type_check", sql`${table.resourceType} in ('', 'work_item', 'document_request', 'office_task', 'leave_request', 'attendance_correction_request', 'payroll_entry', 'invoice', 'dsc_certificate', 'statutory_notice')`),
  check("notifications_resource_pair_check", sql`(${table.resourceType} = '' and ${table.resourceId} is null) or (${table.resourceType} <> '' and ${table.resourceId} is not null)`),
]);

export const notificationDeliveries = pgTable("notification_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  notificationId: uuid("notification_id").notNull(),
  channel: text("channel").notNull(),
  status: text("status").notNull().default("pending"),
  attemptCount: integer("attempt_count").notNull().default(0),
  lastError: text("last_error").notNull().default(""),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("notification_deliveries_notification_channel_unique").on(table.tenantId, table.notificationId, table.channel),
  foreignKey({ name: "notification_deliveries_notification_fk", columns: [table.tenantId, table.notificationId], foreignColumns: [notifications.tenantId, notifications.id] }),
  index("notification_deliveries_status_idx").on(table.status, table.createdAt),
  check("notification_deliveries_channel_check", sql`${table.channel} in ('email', 'whatsapp')`),
  check("notification_deliveries_status_check", sql`${table.status} in ('pending', 'sent', 'failed')`),
  check("notification_deliveries_attempts_check", sql`${table.attemptCount} >= 0`),
  check("notification_deliveries_sent_state_check", sql`(${table.status} = 'sent' and ${table.sentAt} is not null) or (${table.status} <> 'sent' and ${table.sentAt} is null)`),
]);

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  actorUserId: uuid("actor_user_id"),
  resourceType: text("resource_type").notNull(),
  resourceId: uuid("resource_id").notNull(),
  action: text("action").notNull(),
  reason: text("reason"),
  correlationId: uuid("correlation_id").notNull().defaultRandom(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("audit_events_resource_idx").on(table.tenantId, table.resourceType, table.resourceId, table.occurredAt),
  index("audit_events_tenant_occurred_idx").on(table.tenantId, table.occurredAt),
  foreignKey({ name: "audit_events_actor_membership_fk", columns: [table.tenantId, table.actorUserId], foreignColumns: [tenantMemberships.tenantId, tenantMemberships.userId] }),
]);
