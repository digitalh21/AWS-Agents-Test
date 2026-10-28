import "dotenv/config";
import { pathToFileURL } from "node:url";
import { db, pool } from "@/db";
import { sanitizeDatabaseUrl } from "@/lib/db-url";
import { users } from "@/db/schema";
import { DEMO_PASSWORD, DEMO_USERS, seedDemoUsers } from "@/lib/demo-users";
import { hashPassword } from "@/lib/password";

/**
 * Standalone demo-user seed.
 *
 *   npx tsx src/db/seed.ts
 *
 * Targets whatever DATABASE_URL is set to (local Postgres by default; set it
 * to the Supabase pooler URL to seed Supabase — remember percent-encoding:
 *   # -> %23    % -> %25).
 *
 * Example:
 *   DATABASE_URL="postgresql://postgres.<ref>:<encoded-pass>@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres" \
 *     npx tsx src/db/seed.ts
 */
export async function main() {
  const host = (() => {
    try {
      return new URL(sanitizeDatabaseUrl(process.env.DATABASE_URL)).hostname;
    } catch {
      return "(unconfigured)";
    }
  })();
  console.log(`[seed] target database host: ${host}`);

  const results = await seedDemoUsers();
  for (const r of results) {
    console.log(`[seed] ${r.status === "created" ? "created " : "exists  "}: ${r.email} (${r.role})`);
  }

  // Verification pass: every demo email must exist with the correct scrypt hash.
  const expectedHash = hashPassword(DEMO_PASSWORD);
  const rows = await db
    .select({ email: users.email, role: users.role, passwordHash: users.passwordHash })
    .from(users);
  const byEmail = new Map(rows.map((r) => [r.email, r]));

  let failures = 0;
  for (const demo of DEMO_USERS) {
    const row = byEmail.get(demo.email);
    const ok = Boolean(row && row.passwordHash === expectedHash && row.role === demo.role);
    if (!ok) failures += 1;
    console.log(
      `[seed] verify ${ok ? "OK  " : "FAIL"}: ${demo.email} role=${row?.role ?? "missing"} hash=${row ? (row.passwordHash === expectedHash ? "match" : "MISMATCH") : "missing"}`,
    );
  }
  if (failures > 0) {
    throw new Error(`${failures} demo account(s) failed verification`);
  }
  console.log(`[seed] done — log in with any demo email and password "${DEMO_PASSWORD}"`);
}

const invokedDirectly = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;

if (invokedDirectly) {
  main()
    .then(async () => {
      await pool.end().catch(() => undefined);
      process.exit(0);
    })
    .catch(async (error) => {
      console.error("[seed] failed:", error instanceof Error ? error.message : error);
      await pool.end().catch(() => undefined);
      process.exit(1);
    });
}
