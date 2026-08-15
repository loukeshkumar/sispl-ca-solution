import { sql } from "drizzle-orm";
import {
  check,
  date,
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
  slug: text("slug").notNull().unique(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  check("tenants_status_check", sql`${table.status} in ('trial', 'active', 'suspended', 'closed')`),
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

export const tenantMemberships = pgTable("tenant_memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  roleKey: text("role_key").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("tenant_memberships_tenant_user_unique").on(table.tenantId, table.userId),
  index("tenant_memberships_tenant_idx").on(table.tenantId),
]);

export const clientGroups = pgTable("client_groups", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  relationshipOwnerId: uuid("relationship_owner_id").references(() => users.id),
  riskStatus: text("risk_status").notNull().default("watch"),
  healthScore: integer("health_score").notNull().default(50),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("client_groups_tenant_name_unique").on(table.tenantId, table.name),
  index("client_groups_tenant_idx").on(table.tenantId),
  check("client_groups_risk_check", sql`${table.riskStatus} in ('healthy', 'watch', 'critical')`),
  check("client_groups_health_score_check", sql`${table.healthScore} between 0 and 100`),
]);

export const legalEntities = pgTable("legal_entities", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  clientGroupId: uuid("client_group_id").notNull().references(() => clientGroups.id),
  legalName: text("legal_name").notNull(),
  displayName: text("display_name").notNull(),
  entityType: text("entity_type").notNull(),
  maskedPan: text("masked_pan").notNull(),
  city: text("city").notNull(),
  relationshipStart: date("relationship_start", { mode: "string" }).notNull(),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("legal_entities_tenant_group_name_unique").on(table.tenantId, table.clientGroupId, table.legalName),
  index("legal_entities_tenant_idx").on(table.tenantId),
]);

export const clientServices = pgTable("client_services", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  legalEntityId: uuid("legal_entity_id").notNull().references(() => legalEntities.id),
  serviceKey: text("service_key").notNull(),
  status: text("status").notNull().default("active"),
}, (table) => [
  unique("client_services_tenant_entity_service_unique").on(table.tenantId, table.legalEntityId, table.serviceKey),
  index("client_services_tenant_idx").on(table.tenantId),
]);

export const registrations = pgTable("registrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  legalEntityId: uuid("legal_entity_id").notNull().references(() => legalEntities.id),
  registrationType: text("registration_type").notNull(),
  registrationKey: text("registration_key").notNull(),
  status: text("status").notNull().default("active"),
}, (table) => [
  unique("registrations_tenant_entity_key_unique").on(table.tenantId, table.legalEntityId, table.registrationKey),
  index("registrations_tenant_idx").on(table.tenantId),
]);

export const workItems = pgTable("work_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  legalEntityId: uuid("legal_entity_id").notNull().references(() => legalEntities.id),
  serviceKey: text("service_key").notNull(),
  periodKey: text("period_key").notNull(),
  status: text("status").notNull(),
  statutoryDueDate: date("statutory_due_date", { mode: "string" }).notNull(),
  internalDueDate: date("internal_due_date", { mode: "string" }),
  assigneeId: uuid("assignee_id").references(() => users.id),
  reviewerId: uuid("reviewer_id").references(() => users.id),
  blockerNote: text("blocker_note").notNull().default(""),
  progress: integer("progress").notNull().default(0),
  missingItemCount: integer("missing_item_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  unique("work_items_tenant_entity_service_period_unique").on(table.tenantId, table.legalEntityId, table.serviceKey, table.periodKey),
  index("work_items_attention_idx").on(table.tenantId, table.status, table.statutoryDueDate),
  check("work_items_status_check", sql`${table.status} in ('critical', 'at_risk', 'waiting', 'review')`),
  check("work_items_progress_check", sql`${table.progress} between 0 and 100`),
  check("work_items_missing_count_check", sql`${table.missingItemCount} >= 0`),
]);

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  resourceType: text("resource_type").notNull(),
  resourceId: uuid("resource_id").notNull(),
  action: text("action").notNull(),
  reason: text("reason"),
  correlationId: uuid("correlation_id").notNull().defaultRandom(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("audit_events_resource_idx").on(table.tenantId, table.resourceType, table.resourceId, table.occurredAt),
]);
