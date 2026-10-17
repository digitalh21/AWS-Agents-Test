import { handleError, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import {
  consumeQuota,
  recordEvents,
  touchSession,
  type TrackedEvent,
} from "@/lib/activity-tracking";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/agent/track-interaction
 *
 * Single batched endpoint for the whole app's interaction telemetry:
 *   Body: {
 *     sessionId, platform?, activeSeconds?,
 *     events: [{ type: "CLICK"|"ACTION"|"NAVIGATION"|"LEAD_OPEN", target, path, meta }]
 *   }
 *
 * One request per flush (client batches every ~5s) keeps 50+ agents cheap:
 * a single multi-row INSERT + one atomic UPSERT for the counters.
 *
 * The Click Quota is enforced HERE (server-side, not just in the UI):
 * when the agent is over the limit, `locked: true` comes back and the client
 * blocks further actions.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json().catch(() => ({}))) as {
      sessionId?: string;
      platform?: string;
      activeSeconds?: number;
      events?: TrackedEvent[];
    };

    const events = Array.isArray(body.events) ? body.events.slice(0, 200) : [];
    const sessionId = (body.sessionId ?? "").trim().slice(0, 80) || null;

    // Persist the raw stream first (audit-grade), then consume quota.
    const stored = await recordEvents(user.id, sessionId, events);

    const { quota, allowed } = await consumeQuota(user.id, events);

    if (sessionId) {
      await touchSession(user.id, sessionId, body.activeSeconds ?? 0, body.platform ?? null);
    }

    return ok({
      ok: true,
      stored,
      quota,
      allowed,
      locked: quota.locked,
      remaining: quota.remaining,
    });
  } catch (error) {
    return handleError(error);
  }
}
