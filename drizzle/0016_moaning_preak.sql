CREATE TABLE "role_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"role_class" text NOT NULL,
	"legacy_role_key" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_definitions_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "role_definitions_class_check" CHECK ("role_definitions"."role_class" in ('admin', 'employee')),
	CONSTRAINT "role_definitions_legacy_role_check" CHECK ("role_definitions"."legacy_role_key" in ('partner', 'manager', 'associate')),
	CONSTRAINT "role_definitions_status_check" CHECK ("role_definitions"."status" in ('active', 'archived')),
	CONSTRAINT "role_definitions_version_check" CHECK ("role_definitions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"role_definition_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_role_permission_unique" UNIQUE("tenant_id","role_definition_id","permission_key")
);
--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD COLUMN "access_class" text DEFAULT 'employee' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD COLUMN "role_definition_id" uuid;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD COLUMN "authorization_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "role_definitions" ADD CONSTRAINT "role_definitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_definitions" ADD CONSTRAINT "role_definitions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_tenant_fk" FOREIGN KEY ("tenant_id","role_definition_id") REFERENCES "public"."role_definitions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "role_definitions_tenant_key_lower_unique" ON "role_definitions" USING btree ("tenant_id",lower("key"));--> statement-breakpoint
CREATE UNIQUE INDEX "role_definitions_tenant_name_lower_unique" ON "role_definitions" USING btree ("tenant_id",lower("name"));--> statement-breakpoint
CREATE INDEX "role_definitions_tenant_class_status_idx" ON "role_definitions" USING btree ("tenant_id","role_class","status");--> statement-breakpoint
CREATE INDEX "role_permissions_role_idx" ON "role_permissions" USING btree ("tenant_id","role_definition_id");--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_role_definition_fk" FOREIGN KEY ("tenant_id","role_definition_id") REFERENCES "public"."role_definitions"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tenant_memberships_role_definition_idx" ON "tenant_memberships" USING btree ("tenant_id","role_definition_id");--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenant_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
INSERT INTO "role_definitions" ("tenant_id", "key", "name", "description", "role_class", "legacy_role_key", "is_system")
SELECT "id", defaults."key", defaults."name", defaults."description", 'employee', defaults."legacy_role_key", true
FROM "tenants"
CROSS JOIN (VALUES
	('partner', 'Partner', 'Firm-wide business approvals without user administration.', 'partner'),
	('manager', 'Manager', 'Team and direct-report delivery supervision.', 'manager'),
	('associate', 'Associate', 'Own and assigned client delivery work.', 'associate')
) AS defaults("key", "name", "description", "legacy_role_key");--> statement-breakpoint
INSERT INTO "role_permissions" ("tenant_id", "role_definition_id", "permission_key")
SELECT roles."tenant_id", roles."id", permissions."permission_key"
FROM "role_definitions" roles
JOIN (VALUES
	('partner', 'dashboard:read'), ('partner', 'clients:write'), ('partner', 'work:write'),
	('partner', 'documents:read'), ('partner', 'documents:write'), ('partner', 'team:read'),
	('partner', 'tasks:read'), ('partner', 'tasks:assign'), ('partner', 'tasks:update:own'),
	('partner', 'attendance:use'), ('partner', 'attendance:review'), ('partner', 'salary:read:own'),
	('partner', 'salary:approve'), ('partner', 'packages:read'), ('partner', 'services:read'),
	('partner', 'client_packages:manage'),
	('manager', 'dashboard:read'), ('manager', 'clients:write'), ('manager', 'work:write'),
	('manager', 'documents:read'), ('manager', 'documents:write'), ('manager', 'team:read'),
	('manager', 'tasks:read'), ('manager', 'tasks:assign'), ('manager', 'tasks:update:own'),
	('manager', 'attendance:use'), ('manager', 'attendance:review'), ('manager', 'salary:read:own'),
	('manager', 'packages:read'), ('manager', 'services:read'), ('manager', 'client_packages:manage'),
	('associate', 'dashboard:read'), ('associate', 'tasks:read'), ('associate', 'tasks:update:own'),
	('associate', 'attendance:use'), ('associate', 'salary:read:own')
) AS permissions("role_key", "permission_key") ON permissions."role_key" = roles."key"
WHERE roles."is_system" = true AND roles."role_class" = 'employee';--> statement-breakpoint
UPDATE "tenant_memberships" memberships
SET "access_class" = CASE WHEN memberships."role_key" = 'firm_administrator' THEN 'super_admin' ELSE 'employee' END,
	"role_definition_id" = roles."id"
FROM "role_definitions" roles
WHERE memberships."tenant_id" = roles."tenant_id"
	AND memberships."role_key" <> 'firm_administrator'
	AND roles."key" = memberships."role_key"
	AND roles."role_class" = 'employee';--> statement-breakpoint
UPDATE "tenant_memberships"
SET "access_class" = 'super_admin', "role_definition_id" = null
WHERE "role_key" = 'firm_administrator';--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_access_class_check" CHECK ("tenant_memberships"."access_class" in ('super_admin', 'admin', 'employee'));--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_authorization_version_check" CHECK ("tenant_memberships"."authorization_version" > 0);--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_super_admin_check" CHECK (("tenant_memberships"."access_class" = 'super_admin' and "tenant_memberships"."role_key" = 'firm_administrator' and "tenant_memberships"."role_definition_id" is null) or "tenant_memberships"."access_class" <> 'super_admin');
