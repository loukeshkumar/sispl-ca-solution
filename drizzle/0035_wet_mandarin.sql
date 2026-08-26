CREATE TABLE "utilisation_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"role_key" text,
	"employee_user_id" uuid,
	"target_basis_points" integer NOT NULL,
	"effective_from" date NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "utilisation_targets_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "utilisation_targets_scope_check" CHECK ("utilisation_targets"."scope" in ('role', 'employee')),
	CONSTRAINT "utilisation_targets_subject_check" CHECK (("utilisation_targets"."scope" = 'role' and "utilisation_targets"."role_key" is not null and "utilisation_targets"."employee_user_id" is null) or ("utilisation_targets"."scope" = 'employee' and "utilisation_targets"."employee_user_id" is not null and "utilisation_targets"."role_key" is null)),
	CONSTRAINT "utilisation_targets_role_value_check" CHECK ("utilisation_targets"."role_key" is null or "utilisation_targets"."role_key" in ('firm_administrator', 'partner', 'manager', 'associate')),
	CONSTRAINT "utilisation_targets_value_check" CHECK ("utilisation_targets"."target_basis_points" between 0 and 10000),
	CONSTRAINT "utilisation_targets_note_check" CHECK (length("utilisation_targets"."note") <= 300)
);
--> statement-breakpoint
ALTER TABLE "utilisation_targets" ADD CONSTRAINT "utilisation_targets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utilisation_targets" ADD CONSTRAINT "utilisation_targets_employee_membership_fk" FOREIGN KEY ("tenant_id","employee_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "utilisation_targets" ADD CONSTRAINT "utilisation_targets_creator_membership_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "utilisation_targets_role_unique" ON "utilisation_targets" USING btree ("tenant_id","role_key","effective_from") WHERE "utilisation_targets"."scope" = 'role';--> statement-breakpoint
CREATE UNIQUE INDEX "utilisation_targets_employee_unique" ON "utilisation_targets" USING btree ("tenant_id","employee_user_id","effective_from") WHERE "utilisation_targets"."scope" = 'employee';--> statement-breakpoint
CREATE INDEX "utilisation_targets_lookup_idx" ON "utilisation_targets" USING btree ("tenant_id","scope","effective_from");