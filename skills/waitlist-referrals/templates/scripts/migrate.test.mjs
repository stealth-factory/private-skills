import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { readMigrationFiles } from "drizzle-orm/migrator";

import { applyPendingMigrations, migrationAction, readMigrateUrl, redact } from "./migrate.mjs";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const appDir = join(scriptsDir, "..");

describe("migration action", () => {
  it("migrates when a URL is present", () => {
    assert.equal(
      migrationAction({ hasUrl: true, requireUrl: false, onVercel: false }),
      "migrate",
    );
  });

  it("skips a local run that has no URL", () => {
    assert.equal(
      migrationAction({ hasUrl: false, requireUrl: false, onVercel: false }),
      "skip",
    );
  });

  it("fails a required or Vercel run that has no URL", () => {
    assert.equal(
      migrationAction({ hasUrl: false, requireUrl: true, onVercel: false }),
      "fail",
    );
    assert.equal(
      migrationAction({ hasUrl: false, requireUrl: false, onVercel: true }),
      "fail",
    );
  });
});

describe("readMigrateUrl", () => {
  it("prefers the unpooled URL", () => {
    assert.equal(
      readMigrateUrl({
        DATABASE_URL_UNPOOLED: " postgresql://unpooled ",
        DATABASE_URL: "postgresql://pooled",
      }),
      "postgresql://unpooled",
    );
  });
});

describe("applyPendingMigrations", () => {
  const fixture = join(scriptsDir, "fixtures", "migrations");

  it("applies each fixture migration once and records it in its own journal schema", async () => {
    const state = { hashes: [], statements: [], queries: [], staleReads: 0 };
    const sql = fakeSql(state);
    const migrations = readMigrationFiles({ migrationsFolder: fixture });

    const first = await applyPendingMigrations(sql, fixture);
    const ran = state.statements.length;
    const second = await applyPendingMigrations(sql, fixture);

    assert.equal(first, migrations.length);
    assert.equal(second, 0);
    assert.equal(state.statements.length, ran);
    assert.deepEqual(
      state.hashes,
      migrations.map((migration) => migration.hash),
    );
    assert.equal(
      state.queries.some((query) => query.includes("from drizzle.__drizzle_migrations")),
      false,
    );
    assert.equal(
      state.queries.some((query) => query.includes("web_drizzle.__drizzle_migrations")),
      true,
    );
    assert.equal(
      state.queries.some((query) => /on conflict\s*\(\s*hash\s*\)\s*do nothing/i.test(query)),
      true,
    );
    assert.equal(
      state.statements.some((statement) => statement.includes("public.projects")),
      false,
    );
    assert.equal(
      state.statements.some((statement) =>
        statement.includes('ADD COLUMN IF NOT EXISTS "short_referral_code"'),
      ),
      true,
    );
    assert.equal(
      state.statements.some((statement) => /\bSET\s+"?referral_code"?\s*=/i.test(statement)),
      false,
    );
    assert.equal(
      state.statements.some(
        (statement) =>
          statement.includes("SET short_referral_code = code") &&
          statement.includes("short_referral_code IS NULL"),
      ),
      true,
    );
  });

  it("treats a hash another runner already recorded as already applied", async () => {
    const migrations = readMigrationFiles({ migrationsFolder: fixture });
    const state = {
      hashes: migrations.map((migration) => migration.hash),
      statements: [],
      queries: [],
      staleReads: 1,
    };
    const sql = fakeSql(state);

    const applied = await applyPendingMigrations(sql, fixture);

    assert.equal(applied, 0);
    assert.deepEqual(
      state.hashes,
      migrations.map((migration) => migration.hash),
    );
    assert.equal(state.statements.length > 0, true);
  });
});

describe("short-code backfill sample", () => {
  it("only fills null short codes and does not rewrite the long token", () => {
    const sample = readFileSync(join(appDir, "sql-samples", "0001_short_referral_code.sql"), "utf8");
    assert.equal(sample.includes('ADD COLUMN IF NOT EXISTS "short_referral_code"'), true);
    assert.equal(/\bSET\s+"?referral_code"?\s*=/i.test(sample), false);
    assert.equal(
      sample.includes("SET short_referral_code = code") &&
        sample.includes("short_referral_code IS NULL"),
      true,
    );
  });
});

describe("redact", () => {
  it("removes a postgres URL", () => {
    assert.equal(
      redact("failed postgresql://user:secret@host/db"),
      "failed postgresql://redacted",
    );
  });
});

describe("migrate script", () => {
  it("skips when no URL is set", () => {
    const result = runScript([]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Skipping drizzle migrations/);
  });

  it("fails a required run without a URL", () => {
    const result = runScript(["--require"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /DATABASE_URL is not set/);
  });
});

function fakeSql(state) {
  const sql = async (strings, ...values) => {
    const text = strings.join("?");
    state.queries.push(text);
    if (text.includes("select hash")) {
      if (state.staleReads > 0) {
        state.staleReads -= 1;
        return [];
      }
      return state.hashes.map((hash) => ({ hash }));
    }
    if (text.includes("insert into web_drizzle.__drizzle_migrations")) {
      const hash = values[0];
      const conflictSafe = /on conflict\s*\(\s*hash\s*\)\s*do nothing/i.test(text);
      if (state.hashes.includes(hash)) {
        if (!conflictSafe) {
          const error = new Error(
            'duplicate key value violates unique constraint "__drizzle_migrations_hash_key"',
          );
          error.code = "23505";
          throw error;
        }
        return [];
      }
      state.hashes.push(hash);
      return [{ hash }];
    }
    return [];
  };
  sql.query = async (text) => {
    state.statements.push(text);
  };
  return sql;
}

function runScript(args) {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  delete env.DATABASE_URL_UNPOOLED;
  delete env.VERCEL;
  return spawnSync(process.execPath, [join(scriptsDir, "migrate.mjs"), ...args], {
    cwd: appDir,
    env,
    encoding: "utf8",
  });
}
