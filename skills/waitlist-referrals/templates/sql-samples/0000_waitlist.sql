CREATE TABLE IF NOT EXISTS "waitlist_referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_signup_id" uuid NOT NULL,
	"referred_signup_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_referrals_not_self" CHECK ("waitlist_referrals"."referrer_signup_id" <> "waitlist_referrals"."referred_signup_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "waitlist_signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email_normalized" text NOT NULL,
	"message" text,
	"referral_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "waitlist_referrals" ADD CONSTRAINT "waitlist_referrals_referrer_signup_id_waitlist_signups_id_fk" FOREIGN KEY ("referrer_signup_id") REFERENCES "public"."waitlist_signups"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "waitlist_referrals" ADD CONSTRAINT "waitlist_referrals_referred_signup_id_waitlist_signups_id_fk" FOREIGN KEY ("referred_signup_id") REFERENCES "public"."waitlist_signups"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "waitlist_referrals_referred_key" ON "waitlist_referrals" USING btree ("referred_signup_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "waitlist_referrals_referrer_idx" ON "waitlist_referrals" USING btree ("referrer_signup_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "waitlist_signups_email_key" ON "waitlist_signups" USING btree ("email_normalized");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "waitlist_signups_referral_code_key" ON "waitlist_signups" USING btree ("referral_code");