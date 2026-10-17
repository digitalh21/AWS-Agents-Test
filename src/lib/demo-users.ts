import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ensureTables } from "@/db/bootstrap";
import { hashPassword } from "@/lib/password";

/**
 * Demo accounts shown on the login page. All share the demo password
 * "password123" (stored as a scrypt hash — plaintext is never persisted).
 *
 * These exist ONLY so a fresh database is explorable immediately.
 */
export const DEMO_PASSWORD = "password123";

export const DEMO_USERS: ReadonlyArray<{ name: string; email: string; role: "ADMIN" | "HR" | "MANAGER" | "AGENT" }> = [
  { name: "Admin User", email: "admin@crm.app", role: "ADMIN" },
  { name: "HR Manager", email: "hr@crm.app", role: "HR" },
  { name: "Floor Manager", email: "manager@crm.app", role: "MANAGER" },
  { name: "Demo Agent", email: "agent1@crm.app", role: "AGENT" },
];

/**
 * Idempotent demo-user seed.
 *
 * - Creates any missing demo account (matched by email).
 * - Leaves EXISTING accounts untouched (never resets a real password).
 *
 * Safe to run repeatedly against any environment (local Postgres or Supabase).
 */
export async function seedDemoUsers() {
  await ensureTables();
  const results: Array<{ email: string; role: string; status: "created" | "exists" }> = [];
  for (const demo of DEMO_USERS) {
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, demo.email))
      .limit(1);
    if (existing) {
      results.push({ email: demo.email, role: demo.role, status: "exists" });
      continue;
    }
    await db.insert(users).values({
      name: demo.name,
      email: demo.email,
      role: demo.role,
      passwordHash: hashPassword(DEMO_PASSWORD),
    });
    results.push({ email: demo.email, role: demo.role, status: "created" });
  }
  return results;
}

/**
 * First-run convenience used by the login route: when the users table is
 * COMPLETELY EMPTY (brand-new database / fresh Supabase project), materialize
 * the demo accounts so the documented demo credentials work out of the box.
 *
 * Never touches a database that already has users (no well-known credentials
 * are injected into a live system).
 */
export async function seedDemoUsersIfEmpty() {
  const [row] = await db.select({ value: sql<number>`count(*)::int` }).from(users);
  if (Number(row?.value ?? 0) > 0) return false;
  await seedDemoUsers();
  return true;
}
