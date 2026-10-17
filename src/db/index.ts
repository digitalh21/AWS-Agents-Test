import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { sanitizeDatabaseUrl } from "@/lib/db-url";

const rawUrl = process.env.DATABASE_URL;

if (!rawUrl) {
  throw new Error("DATABASE_URL is required");
}

// Normalizes dashboard-pasted URLs (percent-encodes # / % in the password,
// fixes known pooler host typos) so the driver never sees a malformed string.
const databaseUrl = sanitizeDatabaseUrl(rawUrl);
const databaseHost = (() => {
  try {
    return new URL(databaseUrl).hostname;
  } catch {
    return "";
  }
})();

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
    // Supabase (pooler + direct) terminates TLS; require it off-loopback hosts.
    ...(databaseHost.endsWith("supabase.com") || databaseHost.endsWith("supabase.co")
      ? { ssl: { rejectUnauthorized: false } }
      : {}),
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);
