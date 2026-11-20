import { count, eq, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

import { waitlistReferrals, waitlistSignups } from "@/db/schema";
import {
  DuplicateEmailError,
  DuplicateReferralCodeError,
  type StoredSignup,
  type WaitlistStore,
} from "./waitlist";

type SignupRow = typeof waitlistSignups.$inferSelect;

type DatabaseHandle = {
  db: ReturnType<typeof drizzle>;
  sql: NeonQueryFunction<false, false>;
};

let handle: DatabaseHandle | null = null;
let databaseUrl: string | null = null;

export function readDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const pooled = env.DATABASE_URL?.trim() ?? "";
  if (pooled.startsWith("postgres")) return pooled;
  const unpooled = env.DATABASE_URL_UNPOOLED?.trim() ?? "";
  if (unpooled.startsWith("postgres")) return unpooled;
  return null;
}

function connect(url: string) {
  if (!handle || databaseUrl !== url) {
    const sql = neon(url);
    handle = {
      db: drizzle(sql, { schema: { waitlistSignups, waitlistReferrals } }),
      sql,
    };
    databaseUrl = url;
  }
  return handle;
}

function mapRow(row: SignupRow): StoredSignup {
  return {
    id: row.id,
    name: row.name,
    emailNormalized: row.emailNormalized,
    message: row.message,
    referralCode: row.referralCode,
    shortReferralCode: row.shortReferralCode,
  };
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (!error || typeof error !== "object") return false;
  const details = error as { code?: string; constraint?: string; message?: string };
  if (details.code !== "23505") return false;
  return details.constraint === constraint || (details.message ?? "").includes(constraint);
}

export function createNeonWaitlistStore(url: string): WaitlistStore {
  const { db, sql } = connect(url);

  return {
    async findByEmail(email) {
      const rows = await db
        .select()
        .from(waitlistSignups)
        .where(eq(waitlistSignups.emailNormalized, email))
        .limit(1);
      const row = rows[0];
      return row ? mapRow(row) : null;
    },
    async findByCode(code) {
      const rows = await db
        .select()
        .from(waitlistSignups)
        .where(
          or(
            eq(waitlistSignups.referralCode, code),
            eq(waitlistSignups.shortReferralCode, code),
          ),
        )
        .limit(1);
      const row = rows[0];
      return row ? mapRow(row) : null;
    },
    async saveSignup({ signup, referrerSignupId }) {
      try {
        const rows = await sql`
          with inserted as (
            insert into waitlist_signups (
              name,
              email_normalized,
              message,
              referral_code,
              short_referral_code
            )
            values (
              ${signup.name},
              ${signup.emailNormalized},
              ${signup.message},
              ${signup.referralCode},
              ${signup.shortReferralCode}
            )
            returning id, name, email_normalized, message, referral_code, short_referral_code
          ),
          referral as (
            insert into waitlist_referrals (referrer_signup_id, referred_signup_id)
            select ${referrerSignupId}::uuid, inserted.id
            from inserted
            where ${referrerSignupId}::uuid is not null
            returning referred_signup_id
          )
          select id, name, email_normalized, message, referral_code, short_referral_code
          from inserted
        `;
        const row = rows[0] as
          | {
              id: string;
              name: string;
              email_normalized: string;
              message: string | null;
              referral_code: string;
              short_referral_code: string | null;
            }
          | undefined;
        if (!row) throw new Error("Insert returned no signup.");
        return {
          id: row.id,
          name: row.name,
          emailNormalized: row.email_normalized,
          message: row.message,
          referralCode: row.referral_code,
          shortReferralCode: row.short_referral_code,
        };
      } catch (error) {
        if (isUniqueViolation(error, "waitlist_signups_email_key")) {
          throw new DuplicateEmailError();
        }
        if (
          isUniqueViolation(error, "waitlist_signups_referral_code_key") ||
          isUniqueViolation(error, "waitlist_signups_short_referral_code_key")
        ) {
          throw new DuplicateReferralCodeError();
        }
        throw error;
      }
    },
    async countReferrals(referrerSignupId) {
      const rows = await db
        .select({ count: count() })
        .from(waitlistReferrals)
        .where(eq(waitlistReferrals.referrerSignupId, referrerSignupId));
      return Number(rows[0]?.count ?? 0);
    },
  };
}
