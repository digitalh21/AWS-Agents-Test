import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { leadOpenLogs } from "@/db/schema";
import { handleError, ok } from "@/lib/api";
import { asUserId, isStaff, requireUser } from "@/lib/auth";
import { getQuota, recentLeadOpens } from "@/lib/activity-tracking";

export const dynamic = "force-dynamic";

/**
 * GET /api/agent/quota[?userId=]
 *
 * Live Click Quota + counters for the dashboard widget.
 * Staff may read any agent's counters; agents only their own.
 */
export async function GET(request: Request) {
  try {
    const viewer = await requireUser();
    const url = new URL(request.url);
    const targetId = asUserId(url.searchParams.get("userId")) ?? viewer.id;

    if (targetId !== viewer.id && !isStaff(viewer.role)) {
      return ok({ error: "Forbidden" }, 403);
    }

    const [quota, opens] = await Promise.all([
      getQuota(targetId),
      recentLeadOpens(targetId, 15),
    ]);

    return ok({
      quota,
      recentLeadOpens: opens.map((o) => ({
        id: o.id,
        leadId: o.leadId,
        action: o.action,
        openedAt: o.openedAt,
        durationMs: o.durationMs,
        path: o.path,
      })),
    });
  } catch (error) {
    return handleError(error);
  }
}
