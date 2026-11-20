---
name: waitlist-referrals
description: Add a pre-launch waitlist with referral links to a Next.js App Router site on Neon Postgres, Drizzle and Resend. The pieces are a signup form (name, email, optional message, optional referral code), a server action, a personal share link `/?ref=<8-char code>`, a referral count per signup, a copy-the-invite button, a public thanks page, and two transactional emails (team notice and thank-you). Use when asked to "add a waitlist", "collect early-access signups", "add referral links / invite codes", "let people share a link to move up the list", "count how many people someone referred", "send a thank-you email on signup", or to debug an existing waitlist built this way. It also covers duplicate emails, self-referral, code collisions, migrating long codes to short ones, and running Drizzle migrations in a Vercel build. Monorepo layout and Neon wiring belong to the sibling skill turborepo-vercel-monorepo.
metadata:
  author: stealth-factory
  co-author: wiiiimm
  version: "1.0.1"
---

# waitlist-referrals

A waitlist where every signup gets a personal share link, and each signup made
through that link is credited to the person who shared it. The templates
come from a waitlist that is running in production, with the product-specific
strings replaced by placeholders. Their 22 unit tests pass after the
placeholders are filled in.

## The shape

```text
?ref=AbC12xYz ──► WaitlistForm (client) ──► joinWaitlistAction (server action)
                     ref prefilled, read-only     │ validateWaitlistInput
                                                  │ joinWaitlist(store, input)   ← pure, store injected
                                                  │   ├─ email exists      → existing signup, alreadyJoined
                                                  │   ├─ ref unknown       → field error on "referral"
                                                  │   ├─ ref is own email  → existing signup, no credit
                                                  │   └─ insert signup + referral row in ONE statement
                                                  │ notifyAfterJoin → Resend ×2 (new signups only)
                                                  └─► { shareUrl, referralCount, alreadyJoined }
/waitlist/thanks/<code> ──► loadPublicReferral → copy button + "N people have joined with your link."
```

| Table | Holds |
| --- | --- |
| `waitlist_signups` | `name`, `email_normalized` (unique), `message?`, `referral_code` (opaque, unique), `short_referral_code` (8 alphanumeric characters, unique, checked) |
| `waitlist_referrals` | `referrer_signup_id` → `referred_signup_id` (unique: a signup is credited once; check: not self) |

The referral count is `count(*)` of `waitlist_referrals` rows for a referrer.
Nothing is denormalised, so the count can't drift.

## Templates

Copy from [templates/](templates/) into the Next.js app. They expect the `@/`
path alias, shadcn `Button`, `Input` and `Textarea` in `@/components/ui`, and
these packages: `drizzle-orm`, `drizzle-kit`, `@neondatabase/serverless`,
`resend` and `server-only`.

| Template | Purpose |
| --- | --- |
| `lib/waitlist.ts` | **The core.** Validation, code generation, `joinWaitlist`, share URL and message, `loadPublicReferral`. No I/O: the store is passed in. |
| `lib/waitlist-db.ts` | The `WaitlistStore` on Neon HTTP + Drizzle. Inserts the signup and the referral row in one CTE, and maps unique violations to typed errors. |
| `lib/waitlist-mail.ts`, `lib/waitlist-mail-send.ts` | Builds the two emails (escaped HTML, header-safe recipient, idempotency keys) and sends them through Resend with one retry. |
| `app/waitlist/actions.ts` | The server action that wires everything together. |
| `app/waitlist/thanks/[token]/page.tsx` | The public page for a code: copy button and count. |
| `components/waitlist.tsx`, `waitlist-form.tsx`, `copy-referral.tsx` | The section, the form (`useActionState`) and the clipboard button with a live-region status. |
| `db/schema.ts`, `drizzle.config.ts` | Schema with the indexes and checks the store relies on. Migrations are journalled in their own schema. |
| `scripts/migrate.mjs`, `push-schema.mjs` (+ test) | A migrator that runs before `next build` on Vercel. Unlike `drizzle-kit migrate`, it is safe to repeat, including when two builds record the same hash. The test uses `scripts/fixtures/migrations`, not the app's generated `drizzle/` history. |
| `lib/*.test.ts` | `node --test` suites with an in-memory store. Keep them; they pin the edge cases below. |
| `sql-samples/` | Two sample migrations as they shipped. `0001` shows how to backfill short codes onto existing rows. |

Placeholders: `__PRODUCT__`, `__FROM_EMAIL__` (a verified Resend sender),
`__NOTICE_EMAIL__` (the team inbox), `__SITE_ORIGIN__` (canonical
`https://…`, no trailing slash), `__REFERRAL_INVITE__`, `__REFERRAL_CLOSER__`
and `__WAITLIST_HOOK__`. When you're done, `grep -rn '__[A-Z_]*__' app components lib db`
must print nothing.

## Procedure

1. **Schema.** Copy `db/schema.ts` and `drizzle.config.ts`. A fresh project
   runs `drizzle-kit generate` once and gets a single migration with both
   tables. Use `sql-samples/` only when you're adding short codes to a table
   that already has rows. Then make the generated SQL repeat-safe
   (`IF NOT EXISTS`, `DO $$ … EXCEPTION WHEN duplicate_object`); see
   [reference/deploy-and-migrations.md](reference/deploy-and-migrations.md).
2. **Library and store.** Copy `lib/`, fill in the placeholders, and run
   `node --experimental-strip-types --test lib/waitlist.test.ts lib/waitlist-mail.test.ts`
   (Node 22.6+).
3. **UI.** Copy the action, components and thanks page. Render `<Waitlist />`
   on the landing page. Keep the `Suspense` around the form: `useSearchParams`
   needs it.
4. **Env (server-only, never `NEXT_PUBLIC_`).** `DATABASE_URL` (pooled, for
   runtime), `DATABASE_URL_UNPOOLED` (for migrations; the Vercel Neon
   integration injects both) and `RESEND_API_KEY`. With no database the form
   says "unavailable" and saves nothing. With no Resend key the mail is
   skipped and logged, and the signup still saves.
5. **Build.** Set `"buildCommand": "node scripts/push-schema.mjs && pnpm run build"`
   in the app's `vercel.json`.
6. **Verify.** Use a preview deployment: sign up, open your `?ref=` link in a
   private window, and sign up a second email. The first signup's thanks page
   should then say 1. Sign up the first email again: you should get "already on
   the waitlist" and no second email.

## Rules that are easy to "fix" wrongly

Each of these is deliberate and covered by a test. Read
[reference/design.md](reference/design.md) before changing any of them.

- **A duplicate email is a success, not an error.** It returns the existing
  signup's share link and count (`alreadyJoined: true`), sends no email, and
  doesn't re-credit a referrer.
- **Self-referral is a silent no-op.** If the email is already on the list,
  the signup returns early as a duplicate. If the referral code belongs to the
  same email, it returns that signup. The database check
  `referrer <> referred` is the last line of defence.
- **An unknown referral code blocks the submit** and shows a field error. A
  mistyped code is never dropped silently, because the referrer would lose the
  credit without anyone noticing.
- **Two codes per signup.** `referral_code` is an opaque 128-bit base64url
  token, and older links use it. `short_referral_code` is the 8-character
  share code. Both resolve; new links use the short one.
- **Short codes use rejection sampling.** A byte is accepted only if it is
  below 248 (= 4 × 62), so every character is equally likely. A collision
  retries up to 5 times, then returns "unavailable". It never overwrites.
- **The signup and its referral row are one SQL statement** (a data-modifying
  CTE). Neon's HTTP driver has no interactive transactions, so two inserts
  could half-fail.
- **The share-URL origin comes from request headers, validated.** If the host
  or protocol looks wrong, the link falls back to relative `/?ref=…`.
  Emails always use the hard-coded `__SITE_ORIGIN__`, never the request.
- **Email never blocks or undoes a signup.** Each email is sent on its own,
  with an idempotency key `waitlist-signup-{notice,thanks}/<signupId>`.
- **A `?ref=` from the URL is read-only** until the server rejects it.
  "Sign up another email" remounts the form without the URL code, so a second
  person on the same device isn't credited to the link by accident.

## Known gaps

The templates deliberately don't do these. Add them when the launch
needs them: [reference/gaps.md](reference/gaps.md).

- Email isn't verified, so the thank-you can go to an address that never
  asked for it.
- No rate limiting or bot protection on the action.
- Referral counts can be inflated with throwaway addresses.
- No unsubscribe or deletion path.
