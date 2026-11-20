ALTER TABLE "waitlist_signups" ADD COLUMN IF NOT EXISTS "short_referral_code" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "waitlist_signups_short_referral_code_key" ON "waitlist_signups" USING btree ("short_referral_code");--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "waitlist_signups" ADD CONSTRAINT "waitlist_signups_short_code_format" CHECK ("waitlist_signups"."short_referral_code" IS NULL OR "waitlist_signups"."short_referral_code" ~ '^[A-Za-z0-9]{8}$');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pgcrypto;--> statement-breakpoint
DO $$
DECLARE
  signup_id uuid;
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  code text;
  drawn int;
  attempts int;
BEGIN
  FOR signup_id IN
    SELECT id FROM waitlist_signups WHERE short_referral_code IS NULL
  LOOP
    attempts := 0;
    LOOP
      attempts := attempts + 1;
      IF attempts > 5 THEN
        RAISE EXCEPTION 'could not assign a short referral code';
      END IF;
      code := '';
      WHILE length(code) < 8 LOOP
        drawn := get_byte(gen_random_bytes(1), 0);
        IF drawn < 248 THEN
          code := code || substr(alphabet, (drawn % 62) + 1, 1);
        END IF;
      END LOOP;
      BEGIN
        UPDATE waitlist_signups
        SET short_referral_code = code
        WHERE id = signup_id AND short_referral_code IS NULL;
        EXIT;
      EXCEPTION
        WHEN unique_violation THEN
          NULL;
      END;
    END LOOP;
  END LOOP;
END $$;
