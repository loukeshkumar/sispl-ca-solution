CREATE TABLE "client_acceptance_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"check_key" text NOT NULL,
	"outcome" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"checked_by_user_id" uuid NOT NULL,
	"checked_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_acceptance_checks_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "client_acceptance_checks_entity_key_unique" UNIQUE("tenant_id","legal_entity_id","check_key"),
	CONSTRAINT "client_acceptance_checks_key_check" CHECK ("client_acceptance_checks"."check_key" in ('conflict', 'independence', 'kyc', 'predecessor', 'integrity')),
	CONSTRAINT "client_acceptance_checks_outcome_check" CHECK ("client_acceptance_checks"."outcome" in ('cleared', 'concern', 'not_applicable')),
	CONSTRAINT "client_acceptance_checks_note_check" CHECK (
    ("client_acceptance_checks"."outcome" = 'cleared' and length("client_acceptance_checks"."note") <= 1000)
    or ("client_acceptance_checks"."outcome" <> 'cleared' and length(trim("client_acceptance_checks"."note")) between 3 and 1000)
  )
);
--> statement-breakpoint
CREATE TABLE "client_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text DEFAULT '' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_acceptances_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "client_acceptances_entity_unique" UNIQUE("tenant_id","legal_entity_id"),
	CONSTRAINT "client_acceptances_status_check" CHECK ("client_acceptances"."status" in ('in_progress', 'accepted', 'declined')),
	CONSTRAINT "client_acceptances_decision_check" CHECK (
    ("client_acceptances"."status" = 'in_progress' and "client_acceptances"."decided_at" is null and "client_acceptances"."decided_by_user_id" is null)
    or ("client_acceptances"."status" = 'accepted' and "client_acceptances"."decided_at" is not null and "client_acceptances"."decided_by_user_id" is not null)
    or ("client_acceptances"."status" = 'declined' and "client_acceptances"."decided_at" is not null and "client_acceptances"."decided_by_user_id" is not null and length(trim("client_acceptances"."decision_note")) > 0)
  ),
	CONSTRAINT "client_acceptances_note_check" CHECK (length("client_acceptances"."decision_note") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "engagement_letter_services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"letter_id" uuid NOT NULL,
	"service_code" text NOT NULL,
	CONSTRAINT "engagement_letter_services_letter_service_unique" UNIQUE("tenant_id","letter_id","service_code"),
	CONSTRAINT "engagement_letter_services_code_check" CHECK ("engagement_letter_services"."service_code" ~ '^[A-Z0-9][A-Z0-9_-]{1,19}$')
);
--> statement-breakpoint
CREATE TABLE "engagement_letters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"legal_entity_id" uuid NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"fee_basis" text DEFAULT 'fixed_retainer' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"issued_on" date,
	"signed_on" date,
	"document_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "engagement_letters_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "engagement_letters_period_check" CHECK ("engagement_letters"."period_to" > "engagement_letters"."period_from"),
	CONSTRAINT "engagement_letters_status_check" CHECK ("engagement_letters"."status" in ('draft', 'issued', 'signed', 'superseded')),
	CONSTRAINT "engagement_letters_fee_basis_check" CHECK ("engagement_letters"."fee_basis" in ('fixed_retainer', 'per_service', 'hourly', 'other')),
	CONSTRAINT "engagement_letters_dates_check" CHECK (
    ("engagement_letters"."status" = 'draft' and "engagement_letters"."issued_on" is null and "engagement_letters"."signed_on" is null)
    or ("engagement_letters"."status" = 'issued' and "engagement_letters"."issued_on" is not null and "engagement_letters"."signed_on" is null)
    or ("engagement_letters"."status" in ('signed', 'superseded') and "engagement_letters"."issued_on" is not null and "engagement_letters"."signed_on" is not null and "engagement_letters"."signed_on" >= "engagement_letters"."issued_on")
  ),
	CONSTRAINT "engagement_letters_note_check" CHECK (length("engagement_letters"."note") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "legal_entities" DROP CONSTRAINT "legal_entities_status_check";--> statement-breakpoint
ALTER TABLE "client_acceptance_checks" ADD CONSTRAINT "client_acceptance_checks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_acceptance_checks" ADD CONSTRAINT "client_acceptance_checks_entity_tenant_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "public"."legal_entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_acceptance_checks" ADD CONSTRAINT "client_acceptance_checks_checker_membership_fk" FOREIGN KEY ("tenant_id","checked_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_acceptances" ADD CONSTRAINT "client_acceptances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_acceptances" ADD CONSTRAINT "client_acceptances_entity_tenant_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "public"."legal_entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_acceptances" ADD CONSTRAINT "client_acceptances_decider_membership_fk" FOREIGN KEY ("tenant_id","decided_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_acceptances" ADD CONSTRAINT "client_acceptances_creator_membership_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_letter_services" ADD CONSTRAINT "engagement_letter_services_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_letter_services" ADD CONSTRAINT "engagement_letter_services_letter_tenant_fk" FOREIGN KEY ("tenant_id","letter_id") REFERENCES "public"."engagement_letters"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_letters" ADD CONSTRAINT "engagement_letters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_letters" ADD CONSTRAINT "engagement_letters_entity_tenant_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "public"."legal_entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_letters" ADD CONSTRAINT "engagement_letters_creator_membership_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_acceptance_checks_entity_idx" ON "client_acceptance_checks" USING btree ("tenant_id","legal_entity_id");--> statement-breakpoint
CREATE INDEX "client_acceptances_status_idx" ON "client_acceptances" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "engagement_letter_services_letter_idx" ON "engagement_letter_services" USING btree ("tenant_id","letter_id");--> statement-breakpoint
CREATE INDEX "engagement_letters_entity_idx" ON "engagement_letters" USING btree ("tenant_id","legal_entity_id","period_from");--> statement-breakpoint
CREATE INDEX "engagement_letters_status_idx" ON "engagement_letters" USING btree ("tenant_id","status");--> statement-breakpoint
ALTER TABLE "legal_entities" ADD CONSTRAINT "legal_entities_status_check" CHECK ("legal_entities"."status" in ('prospect', 'active', 'archived', 'declined'));