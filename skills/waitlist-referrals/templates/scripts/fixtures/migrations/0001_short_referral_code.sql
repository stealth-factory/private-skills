-- Fixture for migrate.test.mjs. Not an app migration.
-- The backfill to copy is sql-samples/0001_short_referral_code.sql.
ALTER TABLE "waitlist_signups" ADD COLUMN IF NOT EXISTS "short_referral_code" text;
--> statement-breakpoint
DO $$
BEGIN
  UPDATE waitlist_signups
  SET short_referral_code = code
  WHERE short_referral_code IS NULL;
END $$;
