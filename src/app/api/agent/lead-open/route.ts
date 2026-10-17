import { handleError, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { closeLead, consumeQuota, openLead, type TrackedEvent } from "@/lib/activity-tracking";

export const dynamic = "force-dynamic";

/**
 * POST /api/agent/lead-open
 *
 * Body: { leadId, action?: "OPEN"|"CALL"|"WHATSAPP"|"STATUS_CHANGE"|"NOTE"|"EDIT"|"PROOF",
 *          path?, platform?, durationMs?, close?: boolean }
 *
 * open  — records WHEN the lead was opened and WHICH action opened it
 * close — stores how long the lead stayed open (durationMs)
 *
 * The open/close pair is what gives management "timestamp + duration +
 * specific action" per lead — and it consumes the agent's Click Quota.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json().catch(() => ({}))) as {
      leadId?: number;
      action?: string;
      path?: string;
      platform?: string;
      durationMs?: number;
      close?: boolean;
    };

    const leadId = Number(body.leadId ?? 0);
    if (!leadId) return ok({ ok: false, error: "leadId is required" }, 422);

    if (body.close) {
      const closed = await closeLead(user.id, leadId, body.durationMs ?? null);
      return ok({ ok: true, closed: closed?.durationMs ?? null });
    }

    // Quota gate: a locked agent cannot open new leads.
    const { quota, allowed } = await consumeQuota(user.id, [
      { type: "LEAD_OPEN", target: `lead:${leadId}`, path: body.path ?? null },
    ]);
    if (quota.locked && allowed <= 0) {
      return ok({ ok: false, locked: true, quota, error: "Daily click quota reached" }, 429);
    }

    const row = await openLead({
      leadId,
      userId: user.id,
      action: body.action ?? "OPEN",
      path: body.path ?? null,
      platform: body.platform ?? null,
    });

    return ok({ ok: true, id: row.id, openedAt: row.openedAt, quota });
  } catch (error) {
    return handleError(error);
  }
}
