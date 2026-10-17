import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { callLogs, leads, users } from "@/db/schema";
import { audit, handleError, ok } from "@/lib/api";
import { requireStaff } from "@/lib/auth";

export const dynamic = "force-dynamic";

const SUMMARY_SQL = {
  unassigned: sql<number>`count(*) filter (where ${leads.assignedAgentId} is null)::int`,
  untouched24h: sql<number>`count(*) filter (where ${leads.status} = 'NEW' and ${leads.assignedAt} < now() - interval '24 hours')::int`,
  rejected: sql<number>`count(*) filter (where ${leads.status} = 'REJECTED')::int`,
  archived: sql<number>`count(*) filter (where ${leads.archivedForAgent} = true)::int`,
};

async function runCleanup() {
  const [before] = await db.select(SUMMARY_SQL).from(leads);

  // 1. Unassign NEW leads untouched for 24h back to the pool
  const unassigned = await db
    .update(leads)
    .set({ assignedAgentId: null, assignedAt: null, updatedAt: new Date(), status: "NEW" })
    .where(
      and(
        eq(leads.status, "NEW"),
        isNull(leads.archivedForAgent),
        sql`${leads.assignedAt} is not null`,
        sql`${leads.assignedAt} < now() - interval '24 hours'`,
        sql`${leads.lastTouchedAt} is null`,
      ),
    )
    .returning({ id: leads.id });

  // 2. Cycle rejected / not-interested leads to a different agent, masking history
  const rejected = await db
    .select({ id: leads.id, agentId: leads.assignedAgentId, cycleCount: leads.cycleCount })
    .from(leads)
    .where(and(eq(leads.status, "REJECTED"), eq(leads.archivedForAgent, false)))
    .limit(500);

  const agents = await db
    .select({ id: users.id, dailyLeadQuota: users.dailyLeadQuota, dailyLeadLimit: users.dailyLeadLimit })
    .from(users)
    .where(and(eq(users.role, "AGENT"), eq(users.isActive, true)))
    .orderBy(users.id);

  // Per Day Lead Limit also gates the auto-recycling: agents at their daily
  // ceiling (assignments made today) are skipped by the cycle allocator.
  const todayLoad = await db
    .select({ agentId: leads.assignedAgentId, value: sql<number>`count(*)::int` })
    .from(leads)
    .where(sql`${leads.assignedAt}::date = current_date and ${leads.assignedAgentId} is not null`)
    .groupBy(leads.assignedAgentId);
  const usedByAgent = new Map(todayLoad.map((r) => [r.agentId, Number(r.value)]));
  const capacityOf = (a: { id: string; dailyLeadLimit: number | null; dailyLeadQuota: number | null }) => {
    const limit = a.dailyLeadLimit ?? a.dailyLeadQuota;
    return limit === null ? Number.POSITIVE_INFINITY : Math.max(0, limit - (usedByAgent.get(a.id) ?? 0));
  };

  let cycled = 0;
  for (const lead of rejected) {
    const others = agents.filter((a) => a.id !== lead.agentId && capacityOf(a) > 0);
    if (others.length === 0) break;
    const next = others[lead.cycleCount % others.length]!;
    usedByAgent.set(next.id, (usedByAgent.get(next.id) ?? 0) + 1);
    await db
      .update(leads)
      .set({
        assignedAgentId: next.id,
        assignedAt: new Date(),
        status: "NEW",
        accessUnlocked: false,
        cycleCount: lead.cycleCount + 1,
        lastTouchedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(leads.id, lead.id));
    cycled += 1;
  }

  // 3. Archive closed/approved leads out of the agent primary view (kept in earnings)
  const archived = await db
    .update(leads)
    .set({ archivedForAgent: true, status: "ARCHIVED", updatedAt: new Date() })
    .where(and(inArray(leads.status, ["CLOSED"]), eq(leads.archivedForAgent, false)))
    .returning({ id: leads.id });

  // 4. Mark dangling dialing logs as abandoned
  const stale = await db
    .update(callLogs)
    .set({ status: "ABANDONED", callEndedAt: new Date() })
    .where(and(eq(callLogs.status, "DIALING"), sql`${callLogs.callStartedAt} < now() - interval '6 hours'`))
    .returning({ id: callLogs.id });

  const [after] = await db.select(SUMMARY_SQL).from(leads);

  await audit({
    action: "CRON_DAILY_CLEANUP",
    detail: `unassigned=${unassigned.length}, cycled=${cycled}, archived=${archived.length}, staleLogs=${stale.length}`,
    meta: { before, after },
  });

  return {
    ranAt: new Date().toISOString(),
    unassignedBackToPool: unassigned.length,
    rejectedCycled: cycled,
    archived: archived.length,
    staleDialingClosed: stale.length,
    historyMasked: true,
    pool: after,
  };
}

export async function GET() {
  try {
    await requireStaff();
    const [stats] = await db.select(SUMMARY_SQL).from(leads);
    return ok({ preview: stats, dryRun: true });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST() {
  try {
    await requireStaff();
    const result = await runCleanup();
    return ok(result);
  } catch (error) {
    return handleError(error);
  }
}


