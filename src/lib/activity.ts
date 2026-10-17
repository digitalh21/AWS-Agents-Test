import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { dailyActivity } from "@/db/schema";

export type ActivityDelta = {
  seconds?: number;
  touchedLeads?: number;
  statusChanges?: number;
  dealsClosed?: number;
  callsMade?: number;
};

export function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Atomically increments a day's counters for an agent.
 * Called by the Page Visibility heartbeat (seconds) and by lead actions
 * (touched / status change / deal closed / call).
 */
export async function bumpDailyActivity(userId: string, delta: ActivityDelta, day = today()) {
  await db
    .insert(dailyActivity)
    .values({
      userId,
      day,
      activeSeconds: Math.max(0, Math.floor(delta.seconds ?? 0)),
      touchedLeads: Math.max(0, Math.floor(delta.touchedLeads ?? 0)),
      statusChanges: Math.max(0, Math.floor(delta.statusChanges ?? 0)),
      dealsClosed: Math.max(0, Math.floor(delta.dealsClosed ?? 0)),
      callsMade: Math.max(0, Math.floor(delta.callsMade ?? 0)),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [dailyActivity.userId, dailyActivity.day],
      set: {
        activeSeconds: sql`${dailyActivity.activeSeconds} + ${Math.max(0, Math.floor(delta.seconds ?? 0))}`,
        touchedLeads: sql`${dailyActivity.touchedLeads} + ${Math.max(0, Math.floor(delta.touchedLeads ?? 0))}`,
        statusChanges: sql`${dailyActivity.statusChanges} + ${Math.max(0, Math.floor(delta.statusChanges ?? 0))}`,
        dealsClosed: sql`${dailyActivity.dealsClosed} + ${Math.max(0, Math.floor(delta.dealsClosed ?? 0))}`,
        callsMade: sql`${dailyActivity.callsMade} + ${Math.max(0, Math.floor(delta.callsMade ?? 0))}`,
        updatedAt: new Date(),
      },
    });
}

/** Last N days of snapshots for an agent, most recent first. */
export async function activityHistory(userId: string, limit = 30) {
  return db
    .select()
    .from(dailyActivity)
    .where(eq(dailyActivity.userId, userId))
    .orderBy(desc(dailyActivity.day))
    .limit(limit);
}

/** Aggregate totals over a date range (or all time). */
export async function activityTotals(userId: string, fromDay?: string) {
  const [row] = await db
    .select({
      activeSeconds: sql<number>`coalesce(sum(${dailyActivity.activeSeconds}), 0)::int`,
      touchedLeads: sql<number>`coalesce(sum(${dailyActivity.touchedLeads}), 0)::int`,
      statusChanges: sql<number>`coalesce(sum(${dailyActivity.statusChanges}), 0)::int`,
      dealsClosed: sql<number>`coalesce(sum(${dailyActivity.dealsClosed}), 0)::int`,
      callsMade: sql<number>`coalesce(sum(${dailyActivity.callsMade}), 0)::int`,
      days: sql<number>`count(*)::int`,
    })
    .from(dailyActivity)
    .where(fromDay ? and(eq(dailyActivity.userId, userId), sql`${dailyActivity.day} >= ${fromDay}`) : eq(dailyActivity.userId, userId));
  return {
    activeSeconds: Number(row?.activeSeconds ?? 0),
    touchedLeads: Number(row?.touchedLeads ?? 0),
    statusChanges: Number(row?.statusChanges ?? 0),
    dealsClosed: Number(row?.dealsClosed ?? 0),
    callsMade: Number(row?.callsMade ?? 0),
    days: Number(row?.days ?? 0),
  };
}

/** Today's live counters (used for the profile header). */
export async function activityToday(userId: string) {
  const [row] = await db
    .select()
    .from(dailyActivity)
    .where(and(eq(dailyActivity.userId, userId), eq(dailyActivity.day, today())))
    .limit(1);
  return {
    activeSeconds: Number(row?.activeSeconds ?? 0),
    touchedLeads: Number(row?.touchedLeads ?? 0),
    statusChanges: Number(row?.statusChanges ?? 0),
    dealsClosed: Number(row?.dealsClosed ?? 0),
    callsMade: Number(row?.callsMade ?? 0),
  };
}
