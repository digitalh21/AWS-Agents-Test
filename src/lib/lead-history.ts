import { db } from "@/db";
import { leadHistory } from "@/db/schema";

export type LeadChange = { field: string; oldValue?: unknown; newValue?: unknown };

type Actor = { id: string; role: string; name?: string | null };

/**
 * Appends the staff-visible lead timeline. One row per changed field; rows
 * whose old and new values match are skipped. NEVER throws — history is
 * audit-grade but must not break the business mutation itself.
 */
export async function recordLeadHistory(opts: { leadId: number; actor: Actor; changes: LeadChange[] }) {
  const rows = opts.changes
    .filter((c) => String(c.oldValue ?? "") !== String(c.newValue ?? ""))
    .map((c) => ({
      leadId: opts.leadId,
      changedBy: opts.actor.id,
      changedByName: opts.actor.name ?? null,
      changedByRole: opts.actor.role,
      fieldName: c.field,
      oldValue: c.oldValue == null ? null : String(c.oldValue),
      newValue: c.newValue == null ? null : String(c.newValue),
    }));
  if (rows.length === 0) return;
  try {
    await db.insert(leadHistory).values(rows);
  } catch (e) {
    console.error("[lead-history] write failed", e);
  }
}

/** Diff a PATCH object against the stored lead row, producing timeline changes. */
export function diffLeadChanges(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
  labels?: Record<string, string>,
): LeadChange[] {
  const out: LeadChange[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (key === "updatedAt") continue;
    out.push({ field: labels?.[key] ?? key, oldValue: before[key], newValue: value });
  }
  return out;
}
