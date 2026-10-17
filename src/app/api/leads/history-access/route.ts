import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { historyAccessRequests, leads, notifications } from "@/db/schema";
import { audit, fail, handleError, ok } from "@/lib/api";
import { requireStaff, requireUser } from "@/lib/auth";
import { agentHistoryVisible } from "@/lib/settings";

export const dynamic = "force-dynamic";

/** Agent asks HR/Admin to reveal past call notes on this lead. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as { leadId?: number; reason?: string };
    const leadId = Number(body.leadId ?? 0);
    if (!leadId) return fail("leadId required", 422);

    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    if (!lead) return fail("Lead not found", 404);
    if (lead.assignedAgentId !== user.id) return fail("This lead is not assigned to you", 403);

    if (await agentHistoryVisible()) {
      return ok({ granted: true, alreadyOpen: true });
    }

    const existing = await db
      .select({ id: historyAccessRequests.id, status: historyAccessRequests.status })
      .from(historyAccessRequests)
      .where(eq(historyAccessRequests.leadId, leadId))
      .orderBy(desc(historyAccessRequests.createdAt))
      .limit(1);

    if (existing[0]?.status === "PENDING") {
      return ok({ pending: true, requestId: existing[0].id });
    }

    const [row] = await db
      .insert(historyAccessRequests)
      .values({
        leadId,
        userId: user.id,
        reason: (body.reason ?? "").trim() || null,
        status: "PENDING",
      })
      .returning();

    await db.insert(notifications).values({
      title: "History access requested",
      body: `${user.name} requested past call history for ${lead.businessName} (${lead.leadCode ?? `#${leadId}`}).`,
      audienceRole: "ALL",
      sentBy: user.id,
    });

    await audit({
      actorId: user.id,
      actorRole: user.role,
      leadId,
      action: "HISTORY_ACCESS_REQUESTED",
      detail: body.reason ?? "no reason given",
    });

    return ok({ pending: true, requestId: row!.id }, 201);
  } catch (error) {
    return handleError(error);
  }
}

/** Staff grant or deny history access. */
export async function PATCH(request: Request) {
  try {
    const staff = await requireStaff();
    const body = (await request.json()) as { id?: number; action?: string; note?: string };
    const id = Number(body.id ?? 0);
    const approve = String(body.action ?? "").toUpperCase() === "APPROVE";
    if (!id) return fail("id required", 422);

    const [req] = await db.select().from(historyAccessRequests).where(eq(historyAccessRequests.id, id)).limit(1);
    if (!req) return fail("Request not found", 404);
    if (req.status !== "PENDING") return fail("Request already reviewed", 409);

    await db
      .update(historyAccessRequests)
      .set({
        status: approve ? "APPROVED" : "REJECTED",
        grantedBy: approve ? staff.id : null,
        resolvedNote: body.note ?? null,
        decidedAt: new Date(),
      })
      .where(eq(historyAccessRequests.id, id));

    await db.insert(notifications).values({
      title: approve ? "History access granted" : "History access denied",
      body: approve
        ? `You can now read the past call notes on lead #${req.leadId}.`
        : `Your history request for lead #${req.leadId} was declined. ${body.note ?? ""}`,
      audienceRole: "ALL",
      targetUserId: req.userId,
      sentBy: staff.id,
    });

    await audit({
      actorId: staff.id,
      actorRole: staff.role,
      leadId: req.leadId,
      action: approve ? "HISTORY_ACCESS_GRANTED" : "HISTORY_ACCESS_DENIED",
      detail: body.note ?? "",
    });

    return ok({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
