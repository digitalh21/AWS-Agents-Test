import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { historyAccessRequests, leadRequests, leads, niches, notifications, users } from "@/db/schema";
import { audit, fail, handleError, ok, parseIntOr } from "@/lib/api";
import { requireStaff, requireUser } from "@/lib/auth";
import { emitDecisionNotice } from "@/lib/decisions";
import { ensureSeed } from "@/lib/seed";

export const dynamic = "force-dynamic";

/** Unified queue: replace-lead requests, new-lead requests and history-access grants. */
export async function GET(request: Request) {
  try {
    await ensureSeed();
    const user = await requireUser();
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") ?? "ALL";

    if (!["ADMIN", "HR", "MANAGER"].includes(user.role)) {
      const mine = await db
        .select({
          id: leadRequests.id,
          kind: leadRequests.kind,
          leadId: leadRequests.leadId,
          businessName: leads.businessName,
          leadCode: leads.leadCode,
          quantity: leadRequests.quantity,
          reason: leadRequests.reason,
          note: leadRequests.note,
          status: leadRequests.status,
          resolvedNote: leadRequests.resolvedNote,
          createdAt: leadRequests.createdAt,
        })
        .from(leadRequests)
        .leftJoin(leads, eq(leads.id, leadRequests.leadId))
        .where(eq(leadRequests.userId, user.id))
        .orderBy(desc(leadRequests.createdAt))
        .limit(25);

      const hist = await db
        .select({
          id: historyAccessRequests.id,
          leadId: historyAccessRequests.leadId,
          businessName: leads.businessName,
          status: historyAccessRequests.status,
          resolvedNote: historyAccessRequests.resolvedNote,
          createdAt: historyAccessRequests.createdAt,
        })
        .from(historyAccessRequests)
        .leftJoin(leads, eq(leads.id, historyAccessRequests.leadId))
        .where(eq(historyAccessRequests.userId, user.id))
        .orderBy(desc(historyAccessRequests.createdAt))
        .limit(25);

      return ok({ replaces: mine, historyAccess: hist, counts: { pending: mine.filter((r) => r.status === "PENDING").length } });
    }

    const [replaces, history, pendingCount] = await Promise.all([
      db
        .select({
          id: leadRequests.id,
          kind: leadRequests.kind,
          leadId: leadRequests.leadId,
          businessName: leads.businessName,
          leadCode: leads.leadCode,
          leadStatus: leads.status,
          agentId: leadRequests.userId,
          agentName: users.name,
          agentPhone: users.phone,
          nicheName: niches.name,
          quantity: leadRequests.quantity,
          reason: leadRequests.reason,
          note: leadRequests.note,
          status: leadRequests.status,
          resolvedNote: leadRequests.resolvedNote,
          createdAt: leadRequests.createdAt,
        })
        .from(leadRequests)
        .leftJoin(leads, eq(leads.id, leadRequests.leadId))
        .innerJoin(users, eq(users.id, leadRequests.userId))
        .leftJoin(niches, eq(niches.id, leadRequests.nicheId))
        .where(scope === "PENDING" ? eq(leadRequests.status, "PENDING") : undefined)
        .orderBy(desc(leadRequests.createdAt))
        .limit(80),
      db
        .select({
          id: historyAccessRequests.id,
          leadId: historyAccessRequests.leadId,
          businessName: leads.businessName,
          leadCode: leads.leadCode,
          agentId: historyAccessRequests.userId,
          agentName: users.name,
          reason: historyAccessRequests.reason,
          status: historyAccessRequests.status,
          resolvedNote: historyAccessRequests.resolvedNote,
          createdAt: historyAccessRequests.createdAt,
        })
        .from(historyAccessRequests)
        .leftJoin(leads, eq(leads.id, historyAccessRequests.leadId))
        .innerJoin(users, eq(users.id, historyAccessRequests.userId))
        .where(scope === "PENDING" ? eq(historyAccessRequests.status, "PENDING") : undefined)
        .orderBy(desc(historyAccessRequests.createdAt))
        .limit(80),
      db.select({ value: sql<number>`count(*)::int` }).from(leadRequests).where(eq(leadRequests.status, "PENDING")),
    ]);

    return ok({
      replaces,
      historyAccess: history,
      counts: {
        pending: Number(pendingCount[0]?.value ?? 0),
        replacePending: replaces.filter((r) => r.kind === "REPLACE_LEAD" && r.status === "PENDING").length,
        historyPending: history.filter((r) => r.status === "PENDING").length,
      },
    });
  } catch (error) {
    return handleError(error);
  }
}

/** Agents file a request: kind = REPLACE_LEAD (with mandatory reason) or NEW_LEADS. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as {
      kind?: string;
      leadId?: number;
      reason?: string;
      note?: string;
      quantity?: number;
      nicheId?: number;
    };

    if (!["AGENT", "ADMIN", "HR", "MANAGER"].includes(user.role)) return fail("Not permitted", 403);

    const kind = body.kind === "REPLACE_LEAD" ? "REPLACE_LEAD" : "NEW_LEADS";
    const reason = (body.reason ?? "").trim();

    if (kind === "REPLACE_LEAD") {
      if (reason.length < 10) return fail("Reason for replacement must be at least 10 characters", 422);
      const leadId = Number(body.leadId ?? 0);
      if (!leadId) return fail("leadId is required", 422);

      const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
      if (!lead) return fail("Lead not found", 404);
      if (lead.assignedAgentId !== user.id) return fail("This lead is not assigned to you", 403);

      const [row] = await db
        .insert(leadRequests)
        .values({
          userId: user.id,
          leadId,
          nicheId: lead.nicheId,
          kind: "REPLACE_LEAD",
          reason,
          note: body.note ?? null,
          quantity: 1,
          status: "PENDING",
        })
        .returning();

      await db.insert(notifications).values({
        title: "Lead replacement requested",
        body: `${user.name} asked to replace ${lead.businessName} (${lead.leadCode ?? `#${leadId}`}). Reason: ${reason.slice(0, 140)}`,
        audienceRole: "ALL",
        sentBy: user.id,
      });

      await audit({
        actorId: user.id,
        actorRole: user.role,
        leadId,
        action: "LEAD_REPLACE_REQUESTED",
        detail: reason,
      });

      return ok({ request: row }, 201);
    }

    const quantity = Math.max(1, Math.min(200, Number(body.quantity ?? 10)));
    const [row] = await db
      .insert(leadRequests)
      .values({
        userId: user.id,
        nicheId: body.nicheId ? Number(body.nicheId) : user.primaryNicheId,
        kind: "NEW_LEADS",
        quantity,
        note: body.note ?? null,
        status: "PENDING",
      })
      .returning();
    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: "LEAD_REQUEST_CREATED",
      detail: `${quantity} leads requested`,
    });
    return ok({ request: row }, 201);
  } catch (error) {
    return handleError(error);
  }
}

/** Approve / reject a request. */
export async function PATCH(request: Request) {
  try {
    const staff = await requireStaff();
    const body = (await request.json()) as { id?: number; action?: string; note?: string };
    const id = Number(body.id ?? 0);
    const approve = String(body.action ?? "").toUpperCase() === "APPROVE";
    const note = body.note ?? null;
    if (!id) return fail("id required", 422);

    const [req] = await db.select().from(leadRequests).where(eq(leadRequests.id, id)).limit(1);
    if (!req) return fail("Request not found", 404);
    if (req.status !== "PENDING") return fail("Request already reviewed", 409);

    if (req.kind === "REPLACE_LEAD") {
      if (!approve) {
        await db
          .update(leadRequests)
          .set({ status: "REJECTED", resolvedNote: note, decidedAt: new Date() })
          .where(eq(leadRequests.id, id));
        await db.insert(notifications).values({
          title: "Replacement request rejected",
          body: `Your request for lead #${req.leadId ?? "—"} was declined. ${note ?? ""}`,
          audienceRole: "ALL",
          targetUserId: req.userId,
          sentBy: staff.id,
        });
        await audit({ actorId: staff.id, actorRole: staff.role, leadId: req.leadId ?? null, action: "LEAD_REPLACE_REJECTED", detail: note ?? "" });

        await emitDecisionNotice({
          userId: req.userId,
          kind: "REPLACE_LEAD",
          status: "REJECTED",
          title: "Lead replacement rejected ❌",
          message: `Your request to replace lead #${req.leadId ?? "—"} was rejected. The lead stays on your queue.`,
          notes: note,
          leadId: req.leadId,
          entityId: id,
          actorName: staff.name,
        });

        return ok({ ok: true, status: "REJECTED" });
      }

      // Return the lead to the pool, then hand the agent a fresh one from the same niche.
      const leadIdNum = Number(req.leadId);
      const [lead] = await db.select().from(leads).where(eq(leads.id, leadIdNum)).limit(1);
      await db
        .update(leads)
        .set({ assignedAgentId: null, assignedAt: null, lastTouchedAt: null, accessUnlocked: false, updatedAt: new Date() })
        .where(eq(leads.id, leadIdNum));

      const [replacement] = await db
        .select({ id: leads.id })
        .from(leads)
        .where(
          req.nicheId
            ? and(isNull(leads.assignedAgentId), eq(leads.nicheId, Number(req.nicheId)), sql`${leads.id} <> ${leadIdNum}`)
            : and(isNull(leads.assignedAgentId), sql`${leads.id} <> ${leadIdNum}`),
        )
        .orderBy(leads.id)
        .limit(1);

      if (replacement) {
        await db
          .update(leads)
          .set({
            assignedAgentId: req.userId,
            assignedAt: new Date(),
            status: "NEW",
            accessUnlocked: false,
            updatedAt: new Date(),
          })
          .where(eq(leads.id, replacement.id));
      }

      await db
        .update(leadRequests)
        .set({ status: "APPROVED", resolvedNote: note ?? `Replaced with lead #${replacement?.id ?? "none"}`, decidedAt: new Date() })
        .where(eq(leadRequests.id, id));

      await db.insert(notifications).values({
        title: "Lead replaced ✅",
        body: replacement
          ? `Lead #${req.leadId} returned to the pool. Replacement lead #${replacement.id} assigned to you.`
          : `Lead #${req.leadId} returned to the pool. No replacement available right now.`,
        audienceRole: "ALL",
        targetUserId: req.userId,
        sentBy: staff.id,
      });

      await audit({
        actorId: staff.id,
        actorRole: staff.role,
        leadId: leadIdNum,
        action: "LEAD_REPLACE_APPROVED",
        detail: `replacement -> ${replacement?.id ?? "none"}`,
      });

      await emitDecisionNotice({
        userId: req.userId,
        kind: "REPLACE_LEAD",
        status: "APPROVED",
        title: "Lead replaced ✅",
        message: replacement
          ? `Your request to replace lead #${leadIdNum} was approved. It went back to the pool and lead #${replacement.id} was assigned to you.`
          : `Your request to replace lead #${leadIdNum} was approved. The lead returned to the pool — no replacement is available right now.`,
        notes: note,
        leadId: leadIdNum,
        entityId: id,
        actorName: staff.name,
      });

      return ok({ ok: true, replacementId: replacement?.id ?? null });
    }

    // NEW_LEADS
    if (approve) {
      const pool = await db
        .select({ id: leads.id })
        .from(leads)
        .where(isNull(leads.assignedAgentId))
        .orderBy(leads.id)
        .limit(req.quantity);
      for (const lead of pool) {
        await db
          .update(leads)
          .set({ assignedAgentId: req.userId, assignedAt: new Date(), status: "NEW", updatedAt: new Date() })
          .where(eq(leads.id, lead.id));
      }
      await db
        .update(leadRequests)
        .set({ status: "APPROVED", resolvedNote: `${pool.length} assigned`, decidedAt: new Date() })
        .where(eq(leadRequests.id, id));
    } else {
      await db.update(leadRequests).set({ status: "REJECTED", resolvedNote: note, decidedAt: new Date() }).where(eq(leadRequests.id, id));
    }

    await audit({
      actorId: staff.id,
      actorRole: staff.role,
      action: approve ? "LEAD_REQUEST_APPROVED" : "LEAD_REQUEST_REJECTED",
      detail: `user #${req.userId}`,
    });
    return ok({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
