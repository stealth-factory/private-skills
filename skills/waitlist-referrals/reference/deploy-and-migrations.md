# Deploy and migrations

## Neon on Vercel

The Neon resource is connected to the app's Vercel project through the
Marketplace integration (see the sibling skill `turborepo-vercel-monorepo`).
Every deployment then receives:

| Variable | Used by | Why |
| --- | --- | --- |
| `DATABASE_URL` (pooled) | runtime, through `readDatabaseUrl()` | many short serverless queries |
| `DATABASE_URL_UNPOOLED` | `scripts/migrate.mjs` | DDL and `DO $$` blocks run more reliably on a direct connection |

Each falls back to the other. Both are server-only. Preview deployments get
their own Neon branch, so a preview signup never touches production rows.

Runtime uses `drizzle-orm/neon-http`. **It has no interactive
transactions.** That is why `saveSignup` inserts the signup and the referral
in one CTE statement rather than two calls.

## Running migrations in the build

```json
{ "buildCommand": "node scripts/push-schema.mjs && pnpm run build" }
```

`push-schema.mjs` only spawns `migrate.mjs` and passes its exit code through.
`migrate.mjs`:

- **skips** when there's no URL locally (so `next build` works offline),
  and **fails** with no URL on Vercel (`VERCEL=1`) or with `--require`
  (`pnpm db:migrate`).
- keeps its journal in its **own schema**, `web_drizzle.__drizzle_migrations`.
  This matches `migrations.schema` in `drizzle.config.ts`. In a monorepo where
  another app has its own migrations against the same database, each app keeps
  a separate journal, so neither app replays or skips the other's history.
  Rename `web_drizzle` per app.
- runs each statement in turn and records the hash only after all of them
  have succeeded. The insert is `on conflict (hash) do nothing returning hash`.
  Two overlapping builds can both read the journal before either writes the
  hash. `hash` is unique, so a plain insert aborts the second build even when
  every statement was safe to repeat. A conflict means the other build already
  recorded it; this build counts that migration as not newly applied.
- redacts any `postgres://…` string from errors before printing them.

**Why not `drizzle-kit migrate`?** Two builds can overlap: a preview and a
production build of the same commit, or a quick re-push. Both can see the same
migration as pending. So every statement must be safe to run twice:

```sql
CREATE TABLE IF NOT EXISTS …;
CREATE UNIQUE INDEX IF NOT EXISTS …;
ALTER TABLE … ADD COLUMN IF NOT EXISTS …;
DO $$ BEGIN
  ALTER TABLE … ADD CONSTRAINT … ;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
```

`drizzle-kit generate` doesn't write SQL that way. **Edit each generated file
before committing it.** Keep the `--> statement-breakpoint` markers, because
the migrator splits on them.

`readMigrationFiles` needs the `drizzle/meta/_journal.json` that
`drizzle-kit generate` writes. That's why the SQL here is in `sql-samples/`
and not in a ready-made `drizzle/` folder: generate your own, then harden it.

## Backfilling short codes onto existing signups

`sql-samples/0001_short_referral_code.sql` is the pattern for adding a unique,
random, per-row value to a table that already has rows:

1. `ADD COLUMN IF NOT EXISTS` as nullable, add the unique index, and add a
   format check that allows `NULL`.
2. `CREATE EXTENSION IF NOT EXISTS pgcrypto` for `gen_random_bytes`.
3. In a `DO` block, loop over the rows `WHERE short_referral_code IS NULL`.
   Draw 8 characters with the same `< 248` rejection rule as the TypeScript.
   `UPDATE … WHERE id = … AND short_referral_code IS NULL` inside a nested
   `BEGIN … EXCEPTION WHEN unique_violation` that retries, giving up after 5
   attempts.

Because the `UPDATE` re-checks `IS NULL`, two overlapping builds can't assign
two different codes to the same row. The column stays nullable: the
application treats a missing short code as "use the long token".

## Checks before calling it done

- `pnpm --filter <web> test` runs the two `node --test` suites and the
  migrator test. `scripts/migrate.test.mjs` applies
  `scripts/fixtures/migrations`, a journal of its own. It does not read the
  app's `drizzle/` folder. A fresh `drizzle-kit generate` creates
  `short_referral_code` inside `CREATE TABLE` and has no backfill `UPDATE`,
  so asserting those statements against the app's history fails on a new
  project. The backfill shape is pinned on `sql-samples/0001_short_referral_code.sql`
  and on the fixture the migrator actually runs.
- On a preview deployment, the build log shows `Applied N drizzle migrations.`
  on the first build and `Applied 0 …` on a rebuild.
- `select count(*) from waitlist_referrals where referrer_signup_id = referred_signup_id;`
  returns 0. The check constraint makes it impossible, so a non-zero result
  means the constraint is missing.
