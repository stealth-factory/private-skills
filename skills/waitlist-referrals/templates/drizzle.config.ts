import { defineConfig } from "drizzle-kit";

// `drizzle-kit generate` loads this file without a database. The migrate
// script refuses to run unless the Vercel Neon integration supplied a URL.
const unconfiguredUrl = "postgresql://unconfigured@127.0.0.1:5432/unconfigured";

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  migrations: {
    schema: "web_drizzle",
    table: "__drizzle_migrations",
  },
  dbCredentials: {
    url: readMigrateUrl() ?? unconfiguredUrl,
  },
});

function readMigrateUrl(): string | undefined {
  const unpooled = process.env.DATABASE_URL_UNPOOLED?.trim();
  if (unpooled) return unpooled;
  const pooled = process.env.DATABASE_URL?.trim();
  if (pooled) return pooled;
  return undefined;
}
