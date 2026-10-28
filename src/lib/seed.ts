/**
 * DEMO / MOCK DATA — DISABLED.
 *
 * The application now reads and writes only real records from the live
 * PostgreSQL/Supabase database. No synthetic leads, agents, tickets, approvals,
 * commission entries or broadcasts are ever inserted.
 *
 * `ensureSeed()` is intentionally kept as a no-op so the existing call sites stay
 * valid. It only guarantees the schema exists (idempotent CREATE TABLE IF NOT
 * EXISTS) — it never inserts rows.
 *
 * Empty tables render an empty state in the UI instead of falling back to dummy
 * data.
 */
import { ensureTables } from "@/db/bootstrap";

/**
 * Schema bootstrap only. Performs no data insertion.
 * Retained as a no-op shim for backwards compatibility with existing call sites.
 */
export async function ensureSeed(): Promise<void> {
  await ensureTables();
}

/**
 * Removed. Bulk synthetic lead generation is no longer available.
 * Retained as a rejected shim so accidental calls fail loudly rather than
 * silently creating dummy rows.
 */
export async function generateLeads(): Promise<never> {
  throw new Error(
    "Mock data generation is disabled. Leads must be created through the real lead pipeline or CSV import.",
  );
}

/** No-op: demo templates are no longer seeded. */
export const NICHE_SEED: readonly never[] = [];
