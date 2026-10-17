import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { timeLogs, users } from "@/db/schema";
import { handleError, ok } from "@/lib/api";
import { asUserId, requireUser } from "@/lib/auth";
import { activityHistory, activityToday, activityTotals, bumpDailyActivity, today } from "@/lib/activity";

export const dynamic = "force-dynamic";

/**
 * Page Visibility API heartbeat.
 * Body: { seconds, day?, touchedLeads?, statusChanges?, dealsClosed?, callsMade? }
 * Only visible-tab seconds are ever sent by the client.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json().catch(() => ({}))) as {
      seconds?: number;
      day?: string;
      touchedLeads?: number;
      statusChanges?: number;
      dealsClosed?: number;
      callsMade?: number;
    };

    const seconds = Math.max(0, Math.min(3600, Math.floor(Number(body.seconds ?? 0))));
    const day = body.day ?? today();

    await bumpDailyActivity(
      user.id,
      {
        seconds,
        touchedLeads: Number(body.touchedLeads ?? 0),
        statusChanges: Number(body.statusChanges ?? 0),
        dealsClosed: Number(body.dealsClosed ?? 0),
        callsMade: Number(body.callsMade ?? 0),
      },
      day,
    );

    // legacy rolling total kept for the shell widget
    if (seconds > 0) {
      await db.insert(timeLogs).values({ userId: user.id, day, seconds });
      await db
        .update(users)
        .set({ activeSeconds: sql`${users.activeSeconds} + ${seconds}`, lastSeenAt: new Date(), isOnline: true })
        .where(eq(users.id, user.id));
    }

    const snapshot = await activityToday(user.id);
    return ok({ ok: true, today: snapshot });
  } catch (error) {
    return handleError(error);
  }
}

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const targetId = asUserId(url.searchParams.get("userId")) ?? user.id;

    const [history, snapshot, totals] = await Promise.all([
      activityHistory(targetId, 30),
      activityToday(targetId),
      activityTotals(targetId),
    ]);

    return ok({ today: snapshot, history, totals });
  } catch (error) {
    return handleError(error);
  }
}
