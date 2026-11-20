import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const waitlistSignups = pgTable(
  "waitlist_signups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    message: text("message"),
    referralCode: text("referral_code").notNull(),
    shortReferralCode: text("short_referral_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("waitlist_signups_email_key").on(table.emailNormalized),
    uniqueIndex("waitlist_signups_referral_code_key").on(table.referralCode),
    uniqueIndex("waitlist_signups_short_referral_code_key").on(table.shortReferralCode),
    check(
      "waitlist_signups_short_code_format",
      sql`${table.shortReferralCode} IS NULL OR ${table.shortReferralCode} ~ '^[A-Za-z0-9]{8}$'`,
    ),
  ],
);

export const waitlistReferrals = pgTable(
  "waitlist_referrals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    referrerSignupId: uuid("referrer_signup_id")
      .notNull()
      .references(() => waitlistSignups.id),
    referredSignupId: uuid("referred_signup_id")
      .notNull()
      .references(() => waitlistSignups.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("waitlist_referrals_referred_key").on(table.referredSignupId),
    index("waitlist_referrals_referrer_idx").on(table.referrerSignupId),
    check(
      "waitlist_referrals_not_self",
      sql`${table.referrerSignupId} <> ${table.referredSignupId}`,
    ),
  ],
);
