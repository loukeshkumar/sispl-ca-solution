CREATE TABLE "client_rate_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"employee_user_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"charge_paise_per_hour" bigint NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_rate_overrides_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "client_rate_overrides_scope_effective_unique" UNIQUE("tenant_id","legal_entity_id","employee_user_id","effective_from"),
	CONSTRAINT "client_rate_overrides_charge_check" CHECK ("client_rate_overrides"."charge_paise_per_hour" between 0 and 100000000),
	CONSTRAINT "client_rate_overrides_note_check" CHECK (length("client_rate_overrides"."note") <= 300)
);
--> statement-breakpoint
CREATE TABLE "employee_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_user_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"charge_paise_per_hour" bigint NOT NULL,
	"cost_paise_per_hour" bigint,
	"note" text DEFAULT '' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_rates_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "employee_rates_employee_effective_unique" UNIQUE("tenant_id","employee_user_id","effective_from"),
	CONSTRAINT "employee_rates_charge_check" CHECK ("employee_rates"."charge_paise_per_hour" between 0 and 100000000),
	CONSTRAINT "employee_rates_cost_check" CHECK ("employee_rates"."cost_paise_per_hour" is null or "employee_rates"."cost_paise_per_hour" between 0 and 100000000),
	CONSTRAINT "employee_rates_note_check" CHECK (length("employee_rates"."note") <= 300)
);
--> statement-breakpoint
ALTER TABLE "client_rate_overrides" ADD CONSTRAINT "client_rate_overrides_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_rate_overrides" ADD CONSTRAINT "client_rate_overrides_entity_tenant_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "public"."legal_entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_rate_overrides" ADD CONSTRAINT "client_rate_overrides_employee_membership_fk" FOREIGN KEY ("tenant_id","employee_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_rate_overrides" ADD CONSTRAINT "client_rate_overrides_creator_membership_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_rates" ADD CONSTRAINT "employee_rates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_rates" ADD CONSTRAINT "employee_rates_employee_membership_fk" FOREIGN KEY ("tenant_id","employee_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_rates" ADD CONSTRAINT "employee_rates_creator_membership_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_rate_overrides_lookup_idx" ON "client_rate_overrides" USING btree ("tenant_id","legal_entity_id","employee_user_id","effective_from");--> statement-breakpoint
CREATE INDEX "employee_rates_lookup_idx" ON "employee_rates" USING btree ("tenant_id","employee_user_id","effective_from");