import { defineConfig } from "drizzle-kit";
import { sanitizeDatabaseUrl } from "./src/lib/db-url";

/**
 * Drizzle Kit reads DATABASE_URL from the environment (.env is auto-loaded).
 *
 * Supabase (transaction pooler, port 6543):
 *   DATABASE_URL=postgresql://postgres.<project-ref>:<encoded-password>@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres
 *   npx drizzle-kit push
 *
 * The connection string is passed through sanitizeDatabaseUrl() so a
 * dashboard-pasted password containing raw `#` / `%` characters is
 * automatically percent-encoded (# -> %23, % -> %25) before drizzle-kit
 * parses it.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  dbCredentials: {
    url: sanitizeDatabaseUrl(process.env.DATABASE_URL) || "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
  },
});
