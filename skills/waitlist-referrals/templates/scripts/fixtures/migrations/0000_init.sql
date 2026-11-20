-- Fixture for migrate.test.mjs. Not an app migration.
CREATE TABLE IF NOT EXISTS "waitlist_signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referral_code" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "waitlist_signups_referral_code_key" ON "waitlist_signups" USING btree ("referral_code");
