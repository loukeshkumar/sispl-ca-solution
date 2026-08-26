CREATE TABLE "performance_review_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"dimension" text NOT NULL,
	"rating" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "performance_ratings_review_dimension_unique" UNIQUE("tenant_id","review_id","dimension"),
	CONSTRAINT "performance_ratings_dimension_check" CHECK ("performance_review_ratings"."dimension" in ('delivery', 'quality', 'capability', 'conduct')),
	CONSTRAINT "performance_ratings_rating_check" CHECK ("performance_review_ratings"."rating" in ('below', 'meets', 'exceeds')),
	CONSTRAINT "performance_ratings_note_check" CHECK (length("performance_review_ratings"."note") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "performance_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"employee_user_id" uuid NOT NULL,
	"reviewer_user_id" uuid NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"overall_rating" text,
	"strengths" text DEFAULT '' NOT NULL,
	"development" text DEFAULT '' NOT NULL,
	"evidence_snapshot" text,
	"shared_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "performance_reviews_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "performance_reviews_period_unique" UNIQUE("tenant_id","employee_user_id","period_from","period_to"),
	CONSTRAINT "performance_reviews_status_check" CHECK ("performance_reviews"."status" in ('draft', 'shared', 'acknowledged')),
	CONSTRAINT "performance_reviews_period_check" CHECK ("performance_reviews"."period_to" >= "performance_reviews"."period_from"),
	CONSTRAINT "performance_reviews_rating_check" CHECK ("performance_reviews"."overall_rating" is null or "performance_reviews"."overall_rating" in ('below', 'meets', 'exceeds')),
	CONSTRAINT "performance_reviews_reviewer_separation_check" CHECK ("performance_reviews"."reviewer_user_id" <> "performance_reviews"."employee_user_id"),
	CONSTRAINT "performance_reviews_shared_state_check" CHECK (("performance_reviews"."status" = 'draft' and "performance_reviews"."shared_at" is null) or ("performance_reviews"."status" <> 'draft' and "performance_reviews"."shared_at" is not null and "performance_reviews"."overall_rating" is not null and "performance_reviews"."evidence_snapshot" is not null)),
	CONSTRAINT "performance_reviews_acknowledged_state_check" CHECK (("performance_reviews"."status" = 'acknowledged') = ("performance_reviews"."acknowledged_at" is not null)),
	CONSTRAINT "performance_reviews_text_check" CHECK (length("performance_reviews"."strengths") <= 4000 and length("performance_reviews"."development") <= 4000)
);
--> statement-breakpoint
ALTER TABLE "performance_review_ratings" ADD CONSTRAINT "performance_review_ratings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_review_ratings" ADD CONSTRAINT "performance_ratings_review_tenant_fk" FOREIGN KEY ("tenant_id","review_id") REFERENCES "public"."performance_reviews"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_employee_membership_fk" FOREIGN KEY ("tenant_id","employee_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_reviewer_membership_fk" FOREIGN KEY ("tenant_id","reviewer_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_reviews" ADD CONSTRAINT "performance_reviews_creator_membership_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "performance_ratings_review_idx" ON "performance_review_ratings" USING btree ("tenant_id","review_id");--> statement-breakpoint
CREATE INDEX "performance_reviews_employee_idx" ON "performance_reviews" USING btree ("tenant_id","employee_user_id","period_to");--> statement-breakpoint
CREATE INDEX "performance_reviews_reviewer_idx" ON "performance_reviews" USING btree ("tenant_id","reviewer_user_id","status");