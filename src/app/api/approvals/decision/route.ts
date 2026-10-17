import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  correctionRequests,
  dealApprovals,
  leadRequests,
  leads,
  notifications,
  users,
  withdrawals,
} from "@/db/schema";
import { audit, fail, handleError, ok } from "@/lib/api";
import { requireStaff } from "@/lib/auth";
import { emitDecisionNotice } from "@/lib/decisions";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const staff = await requireStaff();
    const body = (await request.json()) as {
      kind?: string;
      id?: number;
      action?: string;
      note?: string;
      proofUrl?: string;
    };
    const kind = String(body.kind ?? "");
    const id = Number(body.id ?? 0);
    const approve = String(body.action ?? "").toUpperCase() === "APPROVE";
    const note = body.note ?? null;
    if (!id || !kind) return fail("kind and id are required", 422);

    /* ------------------------- deal / commission ------------------------- */
    if (kind === "deal") {
      const [deal] = await db.select().from(dealApprovals).where(eq(dealApprovals.id, id)).limit(1);
      if (!deal) return fail("Deal not found", 404);
      // PENDING = first review; REJECTED = allows the Re-Submit / Re-Approve workflow.
      if (deal.status !== "PENDING" && deal.status !== "REJECTED") {
        return fail("Only pending or rejected deals can be reviewed", 409);
      }
      // Validate BEFORE writing so a bad rejection can never clear the queue.
      if (!approve && !(note && note.trim().length >= 5)) {
        return fail("A rejection reason (min 5 characters) is required — the agent will see it.", 422);
      }

      await db
        .update(dealApprovals)
        .set({
          status: approve ? "APPROVED" : "REJECTED",
          reviewedBy: staff.id,
          reviewNote: note,
          rejectionReason: approve ? null : note,
          proofUrl: body.proofUrl ?? deal.proofUrl,
          decidedAt: new Date(),
        })
        .where(eq(dealApprovals.id, id));

      if (approve) {
        await db
          .update(users)
          .set({
            walletPending: sql`${users.walletPending} + ${deal.commission}`,
            walletTotal: sql`${users.walletTotal} + ${deal.commission}`,
          })
          .where(eq(users.id, deal.agentId));
        await db
          .update(leads)
          .set({ status: "CLOSED", commissionAmount: deal.commission, dealAmount: deal.amount, updatedAt: new Date() })
          .where(eq(leads.id, deal.leadId));
      } else {
        await db.update(leads).set({ status: "REJECTED", updatedAt: new Date() }).where(eq(leads.id, deal.leadId));
      }

      await db.insert(notifications).values({
        title: approve ? "Deal approved 🎉" : "Deal rejected",
        body: approve
          ? `Commission ₹${deal.commission} credited to your pending wallet for lead #${deal.leadId}.`
          : `Proof for lead #${deal.leadId} was rejected. Reason: ${note ?? ""} — please re-upload.`,
        audienceRole: "ALL",
        targetUserId: deal.agentId,
        sentBy: staff.id,
      });

      await audit({
        actorId: staff.id,
        actorRole: staff.role,
        leadId: deal.leadId,
        action: approve ? "DEAL_APPROVED" : "DEAL_REJECTED",
        detail: `commission ₹${deal.commission}`,
        meta: { dealId: id },
      });

      // AUTOMATED AGENT POPUP — payment proof decision
      await emitDecisionNotice({
        userId: deal.agentId,
        kind: "PAYMENT_PROOF",
        status: approve ? "APPROVED" : "REJECTED",
        title: approve ? "Payment proof approved ✅" : "Payment proof rejected ❌",
        message: approve
          ? `Your payment proof for lead #${deal.leadId} was approved. Commission ₹${deal.commission} has been credited.`
          : `Your payment proof for lead #${deal.leadId} was rejected. Please re-upload a valid screenshot.`,
        notes: note,
        leadId: deal.leadId,
        entityId: id,
        actorName: staff.name,
      });

      return ok({ ok: true, status: approve ? "APPROVED" : "REJECTED" });
    }

    /* ------------------------- payout / withdrawal ------------------------- */
    if (kind === "withdrawal") {
      const [req] = await db.select().from(withdrawals).where(eq(withdrawals.id, id)).limit(1);
      if (!req) return fail("Request not found", 404);
      if (req.status !== "PENDING") return fail("Request already reviewed", 409);

      if (approve) {
        await db
          .update(users)
          .set({
            walletPending: sql`greatest(${users.walletPending} - ${req.amount}, 0)`,
            walletApproved: sql`${users.walletApproved} + ${req.amount}`,
          })
          .where(eq(users.id, req.userId));
      }

      await db
        .update(withdrawals)
        .set({
          status: approve ? "APPROVED" : "REJECTED",
          reviewNote: note,
          proofUrl: body.proofUrl ?? req.proofUrl,
          decidedAt: new Date(),
        })
        .where(eq(withdrawals.id, id));

      await db.insert(notifications).values({
        title: approve ? "Payout approved ✅" : "Payout rejected",
        body: approve ? `₹${req.amount} payout marked paid via ${req.method}.` : `Payout of ₹${req.amount} rejected. ${note ?? ""}`,
        audienceRole: "ALL",
        targetUserId: req.userId,
        sentBy: staff.id,
      });

      await audit({
        actorId: staff.id,
        actorRole: staff.role,
        action: approve ? "WITHDRAWAL_APPROVED" : "WITHDRAWAL_REJECTED",
        detail: `₹${req.amount} → user #${req.userId}`,
      });

      await emitDecisionNotice({
        userId: req.userId,
        kind: "COMMISSION",
        status: approve ? "APPROVED" : "REJECTED",
        title: approve ? "Payout approved ✅" : "Payout rejected ❌",
        message: approve
          ? `Your withdrawal of ₹${req.amount} via ${req.method} has been approved and paid.`
          : `Your withdrawal request of ₹${req.amount} was rejected.`,
        notes: note,
        entityId: id,
        actorName: staff.name,
      });

      return ok({ ok: true });
    }

    /* ------------------------- correction request ------------------------- */
    if (kind === "correction") {
      const [req] = await db.select().from(correctionRequests).where(eq(correctionRequests.id, id)).limit(1);
      if (!req) return fail("Request not found", 404);
      if (req.status !== "PENDING") return fail("Request already reviewed", 409);

      if (approve) {
        await db
          .update(leads)
          .set({
            status: req.requestedStatus ?? "IN_PROGRESS",
            archivedForAgent: false,
            updatedAt: new Date(),
          })
          .where(eq(leads.id, req.leadId));
        // The timeline stays append-only: we do NOT delete the previous report.
        // The agent may re-submit because the APPROVED correction request is newer
        // than their last log (see the `submitted` check on the agent detail route).
      }

      await db
        .update(correctionRequests)
        .set({ status: approve ? "APPROVED" : "REJECTED", resolvedNote: note, decidedAt: new Date() })
        .where(eq(correctionRequests.id, id));

      await db.insert(notifications).values({
        title: approve ? "Correction approved" : "Correction rejected",
        body: approve
          ? `Lead #${req.leadId} is unlocked — you can resubmit the report.`
          : `Correction for lead #${req.leadId} rejected. ${note ?? ""}`,
        audienceRole: "ALL",
        targetUserId: req.userId,
        sentBy: staff.id,
      });

      await audit({
        actorId: staff.id,
        actorRole: staff.role,
        leadId: req.leadId,
        action: approve ? "CORRECTION_APPROVED" : "CORRECTION_REJECTED",
        detail: req.reason,
      });

      await emitDecisionNotice({
        userId: req.userId,
        kind: "CORRECTION",
        status: approve ? "APPROVED" : "REJECTED",
        title: approve ? "Correction approved ✅" : "Correction rejected ❌",
        message: approve
          ? `Your correction request on lead #${req.leadId} was approved. The report is unlocked so you can re-submit.`
          : `Your correction request on lead #${req.leadId} was rejected. The submitted report stays locked.`,
        notes: note,
        leadId: req.leadId,
        entityId: id,
        actorName: staff.name,
      });

      return ok({ ok: true });
    }

    /* ------------------------- lead re-assign request ------------------------- */
    if (kind === "leadRequest") {
      const [req] = await db.select().from(leadRequests).where(eq(leadRequests.id, id)).limit(1);
      if (!req) return fail("Request not found", 404);
      if (req.status !== "PENDING") return fail("Request already reviewed", 409);

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
          .set({ status: "APPROVED", decidedAt: new Date(), note: `${pool.length} leads assigned` })
          .where(eq(leadRequests.id, id));
        await db.insert(notifications).values({
          title: "New leads assigned 🚀",
          body: `${pool.length} fresh leads were assigned to you.`,
          audienceRole: "ALL",
          targetUserId: req.userId,
          sentBy: staff.id,
        });
      } else {
        await db
          .update(leadRequests)
          .set({ status: "REJECTED", decidedAt: new Date(), note })
          .where(eq(leadRequests.id, id));
      }

      await audit({
        actorId: staff.id,
        actorRole: staff.role,
        action: approve ? "LEAD_REQUEST_APPROVED" : "LEAD_REQUEST_REJECTED",
        detail: `user #${req.userId} qty ${req.quantity}`,
      });

      await emitDecisionNotice({
        userId: req.userId,
        kind: "REPLACE_LEAD",
        status: approve ? "APPROVED" : "REJECTED",
        title: approve ? "Lead request approved ✅" : "Lead request rejected ❌",
        message: approve
          ? `Your request for ${req.quantity} new lead(s) was approved and they have been assigned to you.`
          : `Your request for ${req.quantity} new lead(s) was rejected.`,
        notes: note,
        entityId: id,
        actorName: staff.name,
      });

      return ok({ ok: true });
    }

    return fail("Unknown approval kind", 400);
  } catch (error) {
    return handleError(error);
  }
}
