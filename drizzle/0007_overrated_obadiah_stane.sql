CREATE TABLE "auth_rate_limits" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_rate_limits_attempt_count_check" CHECK ("auth_rate_limits"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX "auth_rate_limits_updated_idx" ON "auth_rate_limits" USING btree ("updated_at");