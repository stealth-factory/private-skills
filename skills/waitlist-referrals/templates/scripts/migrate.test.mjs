import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
  it("applies each migration once and records it in its own journal schema", async () => {
    const state = { hashes: [], statements: [], queries: [] };
    const sql = fakeSql(state);
    const folder = join(appDir, "drizzle");
    const migrations = readMigrationFiles({ migrationsFolder: folder });

    const first = await applyPendingMigrations(sql, folder);
    const second = await applyPendingMigrations(sql, folder);

    assert.equal(first, migrations.length);
    assert.equal(second, 0);
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
  const sql = async (strings) => {
    const text = strings.join("?");
    state.queries.push(text);
    if (text.includes("select hash")) {
      return state.hashes.map((hash) => ({ hash }));
    }
    return [];
  };
  sql.query = async (text) => {
    state.statements.push(text);
  };
  return new Proxy(sql, {
    apply(target, thisArg, args) {
      const strings = args[0];
      const values = args.slice(1);
      if (strings.join("?").includes("insert into web_drizzle.__drizzle_migrations")) {
        state.hashes.push(values[0]);
      }
      return target.apply(thisArg, args);
    },
  });
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
