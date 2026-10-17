import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  agentActivityEvents,
  agentClickUsage,
  agentSessions,
  leadOpenLogs,
  users,
} from "@/db/schema";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type TrackedEventType = "CLICK" | "ACTION" | "NAVIGATION" | "LEAD_OPEN";

export type TrackedEvent = {
  type: TrackedEventType;
  /** semantic target: button label, element id, route name */
  target?: string | null;
  path?: string | null;
  meta?: Record<string, unknown> | null;
};

export type QuotaSnapshot = {
  /** null = unlimited */
  limit: number | null;
  clicks: number;
  actions: number;
  navigations: number;
  leadOpens: number;
  /** clicks + actions + navigations + leadOpens */
  used: number;
  remaining: number | null;
  locked: boolean;
  day: string;
};

export function today() {
  return new Date().toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/* Quota                                                              */
/* ------------------------------------------------------------------ */

/** Reads today's counters + the configured limit for an agent. */
export async function getQuota(userId: string, day = today()): Promise<QuotaSnapshot> {
  const [user] = await db
    .select({ limit: users.dailyClickQuota })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const [usage] = await db
    .select()
    .from(agentClickUsage)
    .where(and(eq(agentClickUsage.userId, userId), eq(agentClickUsage.day, day)))
    .limit(1);

  const clicks = usage?.clicks ?? 0;
  const actions = usage?.actions ?? 0;
  const navigations = usage?.navigations ?? 0;
  const leadOpens = usage?.leadOpens ?? 0;
  const used = clicks + actions + navigations + leadOpens;
  const limit = user?.limit ?? null;

  return {
    limit,
    clicks,
    actions,
    navigations,
    leadOpens,
    used,
    remaining: limit === null ? null : Math.max(0, limit - used),
    locked: limit !== null && used >= limit,
    day,
  };
}

/**
 * Atomically consumes quota for a batch of events and persists the counters.
 *
 * Uses a single UPSERT per counter column so 50+ agents hitting the same
 * rows concurrently cannot lose increments. Returns the post-consume
 * snapshot plus a per-event allowance (how many of the batch may proceed).
 */
export async function consumeQuota(
  userId: string,
  events: TrackedEvent[],
  day = today(),
): Promise<{ quota: QuotaSnapshot; allowed: number }> {
  const counts = { clicks: 0, actions: 0, navigations: 0, leadOpens: 0 };
  for (const e of events) {
    if (e.type === "CLICK") counts.clicks += 1;
    else if (e.type === "ACTION") counts.actions += 1;
    else if (e.type === "NAVIGATION") counts.navigations += 1;
    else if (e.type === "LEAD_OPEN") counts.leadOpens += 1;
  }
  const total = counts.clicks + counts.actions + counts.navigations + counts.leadOpens;

  // nothing to do — never create a row for an empty batch
  if (total === 0) {
    return { quota: await getQuota(userId, day), allowed: 0 };
  }

  const [user] = await db
    .select({ limit: users.dailyClickQuota })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const limit = user?.limit ?? null;

  // Persist counters (atomic upsert — never a read-modify-write race).
  await db
    .insert(agentClickUsage)
    .values({
      userId,
      day,
      clicks: counts.clicks,
      actions: counts.actions,
      navigations: counts.navigations,
      leadOpens: counts.leadOpens,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [agentClickUsage.userId, agentClickUsage.day],
      set: {
        clicks: sql`${agentClickUsage.clicks} + ${counts.clicks}`,
        actions: sql`${agentClickUsage.actions} + ${counts.actions}`,
        navigations: sql`${agentClickUsage.navigations} + ${counts.navigations}`,
        leadOpens: sql`${agentClickUsage.leadOpens} + ${counts.leadOpens}`,
        updatedAt: new Date(),
      },
    });

  const quota = await getQuota(userId, day);
  // how many of THIS batch are within the limit (0 when already locked)
  const allowed =
    limit === null ? total : Math.max(0, Math.min(total, (limit ?? 0) - (quota.used - total)));

  return { quota, allowed };
}

/* ------------------------------------------------------------------ */
/* Raw event stream                                                   */
/* ------------------------------------------------------------------ */

/**
 * Persists a batch of raw interaction events with ONE multi-row INSERT
 * (no per-event round-trip) so 50+ agents scale cheaply.
 */
export async function recordEvents(
  userId: string,
  sessionId: string | null,
  events: TrackedEvent[],
) {
  if (events.length === 0) return 0;
  const rows = events.slice(0, 200).map((e) => ({
    userId,
    sessionId,
    eventType: e.type,
    target: e.target ? String(e.target).slice(0, 200) : null,
    path: e.path ? String(e.path).slice(0, 300) : null,
    meta: (e.meta ?? null) as Record<string, unknown> | null,
  }));
  try {
    await db.insert(agentActivityEvents).values(rows);
    return rows.length;
  } catch (e) {
    console.error("[activity] event batch failed", e);
    return 0;
  }
}

/* ------------------------------------------------------------------ */
/* Lead open tracking                                                 */
/* ------------------------------------------------------------------ */

/** Records a lead open (and the action that triggered it). */
export async function openLead(params: {
  leadId: number;
  userId: string;
  action?: string;
  path?: string | null;
  platform?: string | null;
}) {
  const [row] = await db
    .insert(leadOpenLogs)
    .values({
      leadId: params.leadId,
      userId: params.userId,
      action: (params.action ?? "OPEN").toUpperCase().slice(0, 40),
      path: params.path ?? null,
      platform: params.platform ?? null,
    })
    .returning({ id: leadOpenLogs.id, openedAt: leadOpenLogs.openedAt });
  return row!;
}

/**
 * Closes the most recent open log for this user+lead and stores the
 * duration the lead stayed on screen.
 */
export async function closeLead(userId: string, leadId: number, durationMs?: number | null) {
  const [open] = await db
    .select()
    .from(leadOpenLogs)
    .where(
      and(
        eq(leadOpenLogs.userId, userId),
        eq(leadOpenLogs.leadId, leadId),
        sql`${leadOpenLogs.closedAt} is null`,
      ),
    )
    .orderBy(desc(leadOpenLogs.openedAt))
    .limit(1);
  if (!open) return null;

  const closedAt = new Date();
  const ms = Math.max(
    0,
    Math.min(86_400_000, Math.round(durationMs ?? closedAt.getTime() - open.openedAt.getTime())),
  );
  await db
    .update(leadOpenLogs)
    .set({ closedAt, durationMs: ms })
    .where(eq(leadOpenLogs.id, open.id));
  return { id: open.id, durationMs: ms };
}

/** Recent lead-open history for one agent (dashboard view). */
export async function recentLeadOpens(userId: string, limit = 20) {
  return db
    .select()
    .from(leadOpenLogs)
    .where(eq(leadOpenLogs.userId, userId))
    .orderBy(desc(leadOpenLogs.openedAt))
    .limit(limit);
}

/* ------------------------------------------------------------------ */
/* Sessions                                                           */
/* ------------------------------------------------------------------ */

/** Upserts the browser session row and adds active seconds. */
export async function touchSession(
  userId: string,
  sessionId: string,
  activeSeconds = 0,
  platform?: string | null,
) {
  await db
    .insert(agentSessions)
    .values({
      userId,
      sessionId,
      activeSeconds: Math.max(0, Math.min(3600, Math.floor(activeSeconds))),
      platform: platform ?? null,
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: agentSessions.sessionId,
      set: {
        lastSeenAt: new Date(),
        activeSeconds: sql`${agentSessions.activeSeconds} + ${Math.max(0, Math.min(3600, Math.floor(activeSeconds)))}`,
        ...(platform ? { platform } : {}),
      },
    });
}

/** Total active seconds across the agent's sessions today. */
export async function sessionActiveSeconds(userId: string, since: Date) {
  const [row] = await db
    .select({ value: sql<number>`coalesce(sum(${agentSessions.activeSeconds}), 0)::int` })
    .from(agentSessions)
    .where(and(eq(agentSessions.userId, userId), sql`${agentSessions.lastSeenAt} >= ${since}`));
  return Number(row?.value ?? 0);
}
