import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bonuses, dealApprovals, notifications, users } from "@/db/schema";
import { audit, fail, handleError, ok } from "@/lib/api";
import { requireStaff } from "@/lib/auth";
import { emitDecisionNotice } from "@/lib/decisions";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/commission/:id?kind=deal|bonus
 * Toggles an earnings entry between PENDING and APPROVED and keeps the agent
 * wallet in sync (credit on approve, reverse on un-approve).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requireStaff();
    const id = Number((await params).id);
    const kind = new URL(request.url).searchParams.get("kind") === "bonus" ? "bonus" : "deal";
    const status = String((await request.json().catch(() => ({}))).status ?? "APPROVED").toUpperCase();
    if (!["PENDING", "APPROVED", "REJECTED"].includes(status)) return fail("Invalid status", 422);
    if (!id) return fail("id required", 422);

    if (kind === "bonus") {
      const [bonus] = await db.select().from(bonuses).where(eq(bonuses.id, id)).limit(1);
      if (!bonus) return fail("Bonus not found", 404);
      const wasApproved = bonus.status === "APPROVED";
      const willApprove = status === "APPROVED";

      await db.update(bonuses).set({ status }).where(eq(bonuses.id, id));

      if (!wasApproved && willApprove) {
        await db
          .update(users)
          .set({
            walletPending: sql`${users.walletPending} + ${bonus.amount}`,
            walletTotal: sql`${users.walletTotal} + ${bonus.amount}`,
          })
          .where(eq(users.id, bonus.userId));
      } else if (wasApproved && !willApprove) {
        await db
          .update(users)
          .set({
            walletPending: sql`greatest(${users.walletPending} - ${bonus.amount}, 0)`,
            walletTotal: sql`greatest(${users.walletTotal} - ${bonus.amount}, 0)`,
          })
          .where(eq(users.id, bonus.userId));
      }

      await db.insert(notifications).values({
        title: `Bonus ${status.toLowerCase()}`,
        body: `Your bonus "${bonus.title}" was marked ${status}.`,
        audienceRole: "ALL",
        targetUserId: bonus.userId,
        sentBy: staff.id,
      });
      await audit({
        actorId: staff.id,
        actorRole: staff.role,
        action: "BONUS_STATUS_CHANGED",
        detail: `bonus #${id} -> ${status}`,
      });

      if (status !== "PENDING") {
        await emitDecisionNotice({
          userId: bonus.userId,
          kind: "COMMISSION",
          status: status === "APPROVED" ? "APPROVED" : "REJECTED",
          title: status === "APPROVED" ? "Bonus approved ✅" : "Bonus rejected ❌",
          message:
            status === "APPROVED"
              ? `Your bonus "${bonus.title}" of ₹${Number(bonus.amount).toLocaleString("en-IN")} was approved and credited.`
              : `Your bonus "${bonus.title}" of ₹${Number(bonus.amount).toLocaleString("en-IN")} was marked ${status.toLowerCase()}.`,
          notes: null,
          entityId: id,
          actorName: staff.name,
        });
      }

      return ok({ ok: true, status });
    }

    const [deal] = await db.select().from(dealApprovals).where(eq(dealApprovals.id, id)).limit(1);
    if (!deal) return fail("Deal not found", 404);
    const wasApproved = deal.status === "APPROVED";
    const willApprove = status === "APPROVED";

    await db
      .update(dealApprovals)
      .set({
        status,
        reviewedBy: staff.id,
        decidedAt: new Date(),
        rejectionReason: status === "REJECTED" ? (deal.rejectionReason ?? "Status changed by management") : null,
      })
      .where(eq(dealApprovals.id, id));

    if (!wasApproved && willApprove) {
      await db
        .update(users)
        .set({
          walletPending: sql`${users.walletPending} + ${deal.commission}`,
          walletTotal: sql`${users.walletTotal} + ${deal.commission}`,
        })
        .where(eq(users.id, deal.agentId));
    } else if (wasApproved && !willApprove) {
      await db
        .update(users)
        .set({
          walletPending: sql`greatest(${users.walletPending} - ${deal.commission}, 0)`,
          walletTotal: sql`greatest(${users.walletTotal} - ${deal.commission}, 0)`,
        })
        .where(eq(users.id, deal.agentId));
    }

    await db.insert(notifications).values({
      title: `Commission ${status.toLowerCase()}`,
      body: `Your commission for lead #${deal.leadId} (${deal.commission}) was marked ${status}.`,
      audienceRole: "ALL",
      targetUserId: deal.agentId,
      sentBy: staff.id,
    });
    await audit({
      actorId: staff.id,
      actorRole: staff.role,
      leadId: deal.leadId,
      action: "DEAL_STATUS_CHANGED",
      detail: `deal #${id} -> ${status}`,
    });

    if (status !== "PENDING") {
      await emitDecisionNotice({
        userId: deal.agentId,
        kind: "PAYMENT_PROOF",
        status: status === "APPROVED" ? "APPROVED" : "REJECTED",
        title: status === "APPROVED" ? "Commission approved ✅" : "Commission rejected ❌",
        message:
          status === "APPROVED"
            ? `Your commission of ₹${Number(deal.commission).toLocaleString("en-IN")} for lead #${deal.leadId} was approved.`
            : `Your commission of ₹${Number(deal.commission).toLocaleString("en-IN")} for lead #${deal.leadId} was marked ${status.toLowerCase()}.`,
        notes: deal.rejectionReason ?? null,
        leadId: deal.leadId,
        entityId: id,
        actorName: staff.name,
      });
    }

    return ok({ ok: true, status });
  } catch (error) {
    return handleError(error);
  }
}

/** DELETE /api/commission/:id?kind=deal|bonus — reverses wallet credit then removes. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const staff = await requireStaff();
    if (staff.role !== "ADMIN" && staff.role !== "HR") return fail("Only ADMIN or HR can delete earnings", 403);
    const id = Number((await params).id);
    const kind = new URL(request.url).searchParams.get("kind") === "bonus" ? "bonus" : "deal";
    if (!id) return fail("id required", 422);

    if (kind === "bonus") {
      const [bonus] = await db.select().from(bonuses).where(eq(bonuses.id, id)).limit(1);
      if (!bonus) return fail("Bonus not found", 404);
      if (bonus.status === "APPROVED") {
        await db
          .update(users)
          .set({
            walletPending: sql`greatest(${users.walletPending} - ${bonus.amount}, 0)`,
            walletTotal: sql`greatest(${users.walletTotal} - ${bonus.amount}, 0)`,
          })
          .where(eq(users.id, bonus.userId));
      }
      await db.delete(bonuses).where(eq(bonuses.id, id));
      await audit({ actorId: staff.id, actorRole: staff.role, action: "BONUS_DELETED", detail: `bonus #${id} (${bonus.amount})` });
      return ok({ deleted: true });
    }

    const [deal] = await db.select().from(dealApprovals).where(eq(dealApprovals.id, id)).limit(1);
    if (!deal) return fail("Deal not found", 404);
    if (deal.status === "APPROVED") {
      await db
        .update(users)
        .set({
          walletPending: sql`greatest(${users.walletPending} - ${deal.commission}, 0)`,
          walletTotal: sql`greatest(${users.walletTotal} - ${deal.commission}, 0)`,
        })
        .where(eq(users.id, deal.agentId));
    }
    await db.delete(dealApprovals).where(eq(dealApprovals.id, id));
    await audit({
      actorId: staff.id,
      actorRole: staff.role,
      leadId: deal.leadId,
      action: "DEAL_DELETED",
      detail: `deal #${id} (${deal.commission}) removed`,
    });
    return ok({ deleted: true });
  } catch (error) {
    return handleError(error);
  }
}
