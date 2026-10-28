import { and, count, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { leads } from "@/db/schema";
import { handleError, ok, parseIntOr } from "@/lib/api";
import { asUserId, requireUser } from "@/lib/auth";
import { ensureSeed } from "@/lib/seed";
import { ASSIGNED_STAGES, UNASSIGNED_STAGES } from "@/lib/rbac";
import { hiddenNicheIds } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** The six counters required across every view. */
export const STAGE_KEYS = [
  "ALL",
  "IN_PROGRESS",
  "CALLBACK",
  "NO_RESPONSE",
  "PAYMENT_APPROVAL",
  "REJECTED",
] as const;

/**
 * GET /api/pipeline/counts
 * Agents are always scoped to their own assigned leads.
 * Staff see the whole book unless `mine=true` / `agentId=` is passed.
 */
export async function GET(request: Request) {
  try {
    await ensureSeed();
    const user = await requireUser();
    const url = new URL(request.url);
    const pipeline = url.searchParams.get("pipeline") === "unassigned" ? "unassigned" : "assigned";
    const nicheId = parseIntOr(url.searchParams.get("nicheId"), 0);
    const agentId = asUserId(url.searchParams.get("agentId"));
    const q = (url.searchParams.get("q") ?? "").trim();
    // Agents are hard-locked to their own queue.
    const forceMine = user.role === "AGENT" || url.searchParams.get("mine") === "true";
    const owner = forceMine ? user.id : agentId;

    // hide niches that are not visible to agents (staff are unaffected)
    const hidden = user.role === "AGENT" ? await hiddenNicheIds() : [];
    if (hidden.length > 0 && nicheId > 0 && hidden.includes(nicheId)) {
      return ok({
        counters: { ALL: 0, IN_PROGRESS: 0, CALLBACK: 0, NO_RESPONSE: 0, PAYMENT_APPROVAL: 0, REJECTED: 0, NEW: 0, CLOSED: 0 },
        byStatus: {},
        scope: { role: user.role, mine: forceMine, agentId: owner ?? null, nicheId: nicheId || null, niches: "hidden" },
      });
    }

    const base = [
      eq(leads.archivedForAgent, false),
      hidden.length > 0 ? (sql`${leads.nicheId} not in (${sql.join(hidden.map((id) => sql`${id}`), sql`, `)})` as never) : undefined,
      nicheId > 0 ? eq(leads.nicheId, nicheId) : undefined,
      owner ? eq(leads.assignedAgentId, owner) : undefined,
      q ? or(ilike(leads.businessName, `%${q}%`), ilike(leads.phone, `%${q}%`), ilike(leads.city, `%${q}%`)) : undefined,
    ].filter(Boolean) as never[];

    const where = and(...base);

    if (pipeline === "unassigned") {
      // Pipeline B — management only, nobody owns these leads
      const [fresh, noResp, rej] = await Promise.all([
        db
          .select({ value: count() })
          .from(leads)
          .where(and(...(base as never[]), sql`(${leads.unassignReason} is null or ${leads.unassignReason} in ('MANUAL','AGENT_LOST'))`)),
        db
          .select({ value: count() })
          .from(leads)
          .where(and(...(base as never[]), eq(leads.status, "NO_RESPONSE"), sql`${leads.unassignReason} = 'AUTO_NO_RESPONSE'`)),
        db
          .select({ value: count() })
          .from(leads)
          .where(and(...(base as never[]), eq(leads.status, "REJECTED"), sql`${leads.unassignReason} = 'AUTO_REJECTED'`)),
      ]);

      const freshN = Number(fresh[0]?.value ?? 0);
      const noRespN = Number(noResp[0]?.value ?? 0);
      const rejN = Number(rej[0]?.value ?? 0);

      return ok({
        pipeline: "unassigned",
        counters: {
          ALL: freshN + noRespN + rejN,
          UNASSIGNED: freshN,
          UNASSIGNED_NO_RESPONSE: noRespN,
          UNASSIGNED_REJECTED: rejN,
        },
        byStatus: { UNASSIGNED: freshN, NO_RESPONSE: noRespN, REJECTED: rejN },
        scope: {
          role: user.role,
          mine: forceMine,
          agentId: owner ?? null,
          nicheId: nicheId || null,
          niches: nicheId > 0 ? "filtered" : "all",
        },
      });
    }

    /* ---------- Pipeline A: assigned ---------- */
    const rows = await db
      .select({
        status: leads.status,
        value: count(),
        assignedToday: sql<number>`count(*) filter (where ${leads.assignedAt}::date = current_date)::int`,
      })
      .from(leads)
      .where(and(...(base as never[]), sql`${leads.assignedAgentId} is not null`))
      .groupBy(leads.status);

    const byStatus: Record<string, number> = {};
    let total = 0;
    let assignedTodayTotal = 0;
    for (const row of rows) {
      const n = Number(row.value);
      byStatus[row.status] = n;
      total += n;
      assignedTodayTotal += Number(row.assignedToday ?? 0);
    }

    const counters: Record<string, number> = {
      ALL: total,
      IN_PROGRESS: byStatus.IN_PROGRESS ?? 0,
      CALLBACK: byStatus.CALLBACK ?? 0,
      NO_RESPONSE: byStatus.NO_RESPONSE ?? 0,
      PAYMENT_APPROVAL: byStatus.PAYMENT_APPROVAL ?? 0,
      REJECTED: byStatus.REJECTED ?? 0,
      NEW: assignedTodayTotal,
      CLOSED: byStatus.CLOSED ?? 0,
    };

    return ok({
      pipeline: "assigned",
      counters,
      byStatus,
      scope: {
        role: user.role,
        mine: forceMine,
        agentId: owner ?? null,
        nicheId: nicheId || null,
        niches: nicheId > 0 ? "filtered" : "all",
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
