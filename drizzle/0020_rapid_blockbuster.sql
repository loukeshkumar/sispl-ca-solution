CREATE TABLE "client_portal_credentials" (
	"portal_user_id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"password_hash" text NOT NULL,
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"password_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_portal_credentials_failed_attempts_check" CHECK ("client_portal_credentials"."failed_login_attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "client_portal_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"portal_user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "client_portal_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"email" text NOT NULL,
	"full_name" text NOT NULL,
	"status" text DEFAULT 'invited' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_portal_users_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "client_portal_users_email_check" CHECK ("client_portal_users"."email" ~ '^[^[:space:]@]+@[^[:space:]@]+.[^[:space:]@]+$' and length("client_portal_users"."email") <= 254),
	CONSTRAINT "client_portal_users_full_name_check" CHECK (length(trim("client_portal_users"."full_name")) between 2 and 120),
	CONSTRAINT "client_portal_users_status_check" CHECK ("client_portal_users"."status" in ('invited', 'active', 'disabled'))
);
--> statement-breakpoint
ALTER TABLE "client_portal_credentials" ADD CONSTRAINT "client_portal_credentials_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_credentials" ADD CONSTRAINT "client_portal_credentials_user_tenant_fk" FOREIGN KEY ("tenant_id","portal_user_id") REFERENCES "public"."client_portal_users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_sessions" ADD CONSTRAINT "client_portal_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_sessions" ADD CONSTRAINT "client_portal_sessions_user_tenant_fk" FOREIGN KEY ("tenant_id","portal_user_id") REFERENCES "public"."client_portal_users"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_users" ADD CONSTRAINT "client_portal_users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_users" ADD CONSTRAINT "client_portal_users_entity_tenant_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "public"."legal_entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_portal_users" ADD CONSTRAINT "client_portal_users_creator_membership_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_portal_sessions_token_hash_unique" ON "client_portal_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "client_portal_sessions_user_idx" ON "client_portal_sessions" USING btree ("tenant_id","portal_user_id");--> statement-breakpoint
CREATE INDEX "client_portal_sessions_expiry_idx" ON "client_portal_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "client_portal_users_tenant_email_lower_unique" ON "client_portal_users" USING btree ("tenant_id",lower("email"));--> statement-breakpoint
CREATE INDEX "client_portal_users_entity_idx" ON "client_portal_users" USING btree ("tenant_id","legal_entity_id","status");