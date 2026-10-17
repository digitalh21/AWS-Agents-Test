import { sql } from "drizzle-orm";
import { db } from "@/db";
import { BOOTSTRAP_SQL } from "@/db/bootstrap-sql";

let applied: Promise<void> | null = null;

/**
 * Ensures every table and index exists.
 *
 * Runs once per process and is idempotent, so a brand-new Postgres or Supabase
 * project self-provisions on the first request instead of returning 500s.
 */
export async function ensureTables() {
  if (!applied) {
    applied = (async () => {
      const statements = BOOTSTRAP_SQL.split(";")
        .map((chunk) =>
          chunk
            .split("\n")
            .filter((line) => !line.trim().startsWith("--"))
            .join("\n")
            .trim(),
        )
        .filter(Boolean);

      for (const statement of statements) {
        await db.execute(sql.raw(statement));
      }
    })().catch((error) => {
      applied = null;
      throw error;
    });
  }
  return applied;
}
