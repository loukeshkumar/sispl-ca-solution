CREATE TABLE "work_review_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"work_item_id" uuid NOT NULL,
	"round" integer NOT NULL,
	"reviewer_user_id" uuid NOT NULL,
	"submitted_by_user_id" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submission_note" text DEFAULT '' NOT NULL,
	"status_before_review" text NOT NULL,
	"outcome" text,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_review_rounds_tenant_id_unique" UNIQUE("tenant_id","id"),
	CONSTRAINT "work_review_rounds_item_round_unique" UNIQUE("tenant_id","work_item_id","round"),
	CONSTRAINT "work_review_rounds_round_check" CHECK ("work_review_rounds"."round" > 0),
	CONSTRAINT "work_review_rounds_outcome_check" CHECK ("work_review_rounds"."outcome" is null or "work_review_rounds"."outcome" in ('approved', 'returned')),
	CONSTRAINT "work_review_rounds_status_check" CHECK ("work_review_rounds"."status_before_review" in ('critical', 'at_risk', 'waiting', 'review')),
	CONSTRAINT "work_review_rounds_decided_state_check" CHECK (("work_review_rounds"."outcome" is null and "work_review_rounds"."decided_by_user_id" is null and "work_review_rounds"."decided_at" is null) or ("work_review_rounds"."outcome" is not null and "work_review_rounds"."decided_by_user_id" is not null and "work_review_rounds"."decided_at" is not null)),
	CONSTRAINT "work_review_rounds_returned_reason_check" CHECK ("work_review_rounds"."outcome" <> 'returned' or length(trim("work_review_rounds"."decision_note")) > 0),
	CONSTRAINT "work_review_rounds_self_review_check" CHECK ("work_review_rounds"."decided_by_user_id" is null or "work_review_rounds"."decided_by_user_id" <> "work_review_rounds"."submitted_by_user_id"),
	CONSTRAINT "work_review_rounds_text_check" CHECK (length("work_review_rounds"."submission_note") <= 2000 and length("work_review_rounds"."decision_note") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "work_review_rounds" ADD CONSTRAINT "work_review_rounds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_review_rounds" ADD CONSTRAINT "work_review_rounds_item_tenant_fk" FOREIGN KEY ("tenant_id","work_item_id") REFERENCES "public"."work_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_review_rounds" ADD CONSTRAINT "work_review_rounds_reviewer_membership_fk" FOREIGN KEY ("tenant_id","reviewer_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_review_rounds" ADD CONSTRAINT "work_review_rounds_submitter_membership_fk" FOREIGN KEY ("tenant_id","submitted_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_review_rounds" ADD CONSTRAINT "work_review_rounds_decider_membership_fk" FOREIGN KEY ("tenant_id","decided_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "work_review_rounds_open_unique" ON "work_review_rounds" USING btree ("tenant_id","work_item_id") WHERE "work_review_rounds"."outcome" is null;--> statement-breakpoint
CREATE INDEX "work_review_rounds_item_idx" ON "work_review_rounds" USING btree ("tenant_id","work_item_id","round");--> statement-breakpoint
CREATE INDEX "work_review_rounds_reviewer_idx" ON "work_review_rounds" USING btree ("tenant_id","reviewer_user_id","outcome");