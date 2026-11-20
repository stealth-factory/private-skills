import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { readMigrationFiles } from "drizzle-orm/migrator";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsFolder = join(appDir, "drizzle");

const missingUrlMessage =
  "DATABASE_URL is not set for this process. The Vercel Neon integration injects it for preview and production deployments.";

export function readMigrateUrl(env = process.env) {
  const unpooled = readEnv(env, "DATABASE_URL_UNPOOLED");
  if (unpooled) return unpooled;
  return readEnv(env, "DATABASE_URL");
}

export function migrationAction({ hasUrl, requireUrl, onVercel }) {
  if (hasUrl) return "migrate";
  if (requireUrl || onVercel) return "fail";
  return "skip";
}

export function redact(text) {
  return text.replace(/postgres(?:ql)?:\/\/\S+/gi, "postgresql://redacted");
}

// Waitlist history lives in web_drizzle, separate from the builder journal.
// Statements run one after another, as the builder script does. The SQL is
// repeat-safe so an overlapping build can apply the same file again. The
// journal insert ignores a hash the other build already recorded: both can
// read the journal before either writes, and `hash` is unique.
export async function applyPendingMigrations(sql, folder = migrationsFolder) {
  await ensureMigrationsTable(sql);
  const appliedRows = await sql`select hash from web_drizzle.__drizzle_migrations`;
  const applied = new Set(appliedRows.map((row) => row.hash));
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  let count = 0;

  for (const migration of migrations) {
    if (applied.has(migration.hash)) continue;
    for (const statement of migration.sql) {
      const text = statement.trim();
      if (text.length === 0) continue;
      await sql.query(text);
    }
    const inserted = await sql`
      insert into web_drizzle.__drizzle_migrations ("hash", "created_at")
      values (${migration.hash}, ${migration.folderMillis})
      on conflict (hash) do nothing
      returning hash
    `;
    count += inserted.length;
  }

  return count;
}

async function ensureMigrationsTable(sql) {
  await sql`create schema if not exists web_drizzle`;
  await sql`
    create table if not exists web_drizzle.__drizzle_migrations (
      id serial primary key,
      hash text not null unique,
      created_at bigint
    )
  `;
}

async function main() {
  const action = migrationAction({
    hasUrl: Boolean(readMigrateUrl()),
    requireUrl: process.argv.includes("--require"),
    onVercel: process.env.VERCEL === "1",
  });

  if (action === "skip") {
    console.log(`Skipping drizzle migrations. ${missingUrlMessage}`);
    return 0;
  }

  if (action === "fail") {
    console.error(missingUrlMessage);
    return 1;
  }

  const url = readMigrateUrl();
  if (!url) {
    console.error(missingUrlMessage);
    return 1;
  }

  const sql = neon(url);
  const applied = await applyPendingMigrations(sql);
  console.log(`Applied ${applied} drizzle migration${applied === 1 ? "" : "s"}.`);
  return 0;
}

const invokedDirectly = process.argv[1]?.endsWith("migrate.mjs") ?? false;
if (invokedDirectly) {
  main()
    .then((code) => {
      process.exit(code);
    })
    .catch((error) => {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
      console.error(redact(message));
      process.exit(1);
    });
}

function readEnv(env, name) {
  const value = env[name];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
