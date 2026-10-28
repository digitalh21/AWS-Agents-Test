import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { correctionRequests, dealApprovals, historyAccessRequests, leadRequests, leads, niches, users, withdrawals } from "@/db/schema";
import { handleError, ok } from "@/lib/api";
import { requireStaff } from "@/lib/auth";
import { ensureSeed } from "@/lib/seed";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await ensureSeed();
    await requireStaff();
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") ?? "ALL";

    const dealSelect = {
      id: dealApprovals.id,
      leadId: dealApprovals.leadId,
      businessName: leads.businessName,
      leadPhone: leads.phone,
      city: leads.city,
      agentId: dealApprovals.agentId,
      agentName: users.name,
      agentPhone: users.phone,
      amount: dealApprovals.amount,
      commission: dealApprovals.commission,
      proofUrl: dealApprovals.proofUrl,
      agentNote: dealApprovals.agentNote,
      status: dealApprovals.status,
      reviewNote: dealApprovals.reviewNote,
      rejectionReason: dealApprovals.rejectionReason,
      createdAt: dealApprovals.createdAt,
      decidedAt: dealApprovals.decidedAt,
    };

    const [deals, withdraws, corrections, requests, replaces, history, counts] = await Promise.all([
      db
        .select(dealSelect)
        .from(dealApprovals)
        .innerJoin(leads, eq(leads.id, dealApprovals.leadId))
        .innerJoin(users, eq(users.id, dealApprovals.agentId))
        .where(["PENDING", "APPROVED", "REJECTED"].includes(scope) ? eq(dealApprovals.status, scope) : undefined)
        .orderBy(desc(dealApprovals.createdAt))
        .limit(80),
      db
        .select({
          id: withdrawals.id,
          userId: withdrawals.userId,
          agentName: users.name,
          agentPhone: users.phone,
          amount: withdrawals.amount,
          method: withdrawals.method,
          destination: withdrawals.destination,
          proofUrl: withdrawals.proofUrl,
          status: withdrawals.status,
          reviewNote: withdrawals.reviewNote,
          createdAt: withdrawals.createdAt,
          decidedAt: withdrawals.decidedAt,
        })
        .from(withdrawals)
        .innerJoin(users, eq(users.id, withdrawals.userId))
        .where(scope === "PENDING" ? eq(withdrawals.status, "PENDING") : undefined)
        .orderBy(desc(withdrawals.createdAt))
        .limit(60),
      db
        .select({
          id: correctionRequests.id,
          leadId: correctionRequests.leadId,
          businessName: leads.businessName,
          userId: correctionRequests.userId,
          agentName: users.name,
          reason: correctionRequests.reason,
          requestedStatus: correctionRequests.requestedStatus,
          status: correctionRequests.status,
          resolvedNote: correctionRequests.resolvedNote,
          createdAt: correctionRequests.createdAt,
          decidedAt: correctionRequests.decidedAt,
        })
        .from(correctionRequests)
        .innerJoin(users, eq(users.id, correctionRequests.userId))
        .innerJoin(leads, eq(leads.id, correctionRequests.leadId))
        .where(scope === "PENDING" ? eq(correctionRequests.status, "PENDING") : undefined)
        .orderBy(desc(correctionRequests.createdAt))
        .limit(60),
      db
        .select({
          id: leadRequests.id,
          userId: leadRequests.userId,
          agentName: users.name,
          quantity: leadRequests.quantity,
          note: leadRequests.note,
          status: leadRequests.status,
          nicheName: niches.name,
          createdAt: leadRequests.createdAt,
          decidedAt: leadRequests.decidedAt,
        })
        .from(leadRequests)
        .innerJoin(users, eq(users.id, leadRequests.userId))
        .leftJoin(niches, eq(niches.id, leadRequests.nicheId))
        .orderBy(desc(leadRequests.createdAt))
        .limit(60),
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
        .orderBy(desc(historyAccessRequests.createdAt))
        .limit(80),
      Promise.all([
        db.select({ value: count() }).from(dealApprovals).where(eq(dealApprovals.status, "PENDING")),
        db.select({ value: count() }).from(withdrawals).where(eq(withdrawals.status, "PENDING")),
        db.select({ value: count() }).from(correctionRequests).where(eq(correctionRequests.status, "PENDING")),
        db.select({ value: count() }).from(leadRequests).where(eq(leadRequests.status, "PENDING")),
      ]).then(([d, w, c, r]) => ({
        deals: Number(d[0]?.value ?? 0),
        withdrawals: Number(w[0]?.value ?? 0),
        corrections: Number(c[0]?.value ?? 0),
        leadRequests: Number(r[0]?.value ?? 0),
      })),
    ]);

    const [commissionSummary] = await db
      .select({
        approvedCommission: sql<number>`coalesce(sum(${dealApprovals.commission}) filter (where ${dealApprovals.status} = 'APPROVED'), 0)::float`,
        pendingCommission: sql<number>`coalesce(sum(${dealApprovals.commission}) filter (where ${dealApprovals.status} = 'PENDING'), 0)::float`,
      })
      .from(dealApprovals);

    const [pendingPayout] = await db
      .select({ total: sql<number>`coalesce(sum(${withdrawals.amount}) filter (where ${withdrawals.status} = 'PENDING'), 0)::float` })
      .from(withdrawals)
      .where(and(eq(withdrawals.status, "PENDING")));

    return ok({
      deals,
      withdrawals: withdraws,
      corrections,
      leadRequests: requests,
      replaces,
      historyAccess: history,
      counts,
      commissionSummary,
      pendingPayout,
    });
  } catch (error) {
    return handleError(error);
  }
}
