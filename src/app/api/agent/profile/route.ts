import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bonuses, dailyActivity, dealApprovals, kycDocuments, leads, niches, users, withdrawals } from "@/db/schema";
import { audit, fail, handleError, ok } from "@/lib/api";
import { asUserId, requireUser, isStaff } from "@/lib/auth";
import { activityHistory, activityToday, activityTotals } from "@/lib/activity";
import { resolveAgentCommission, getDailyQuota } from "@/lib/commission";

export const dynamic = "force-dynamic";

/**
 * GET /api/agent/profile
 * `?include=earnings` -> itemized commission + bonus breakdown
 * `?userId=`          -> staff viewing another agent's profile
 * `?view=<agentId>`   -> pipeline breakdown for that agent
 */
export async function GET(request: Request) {
  try {
    const viewer = await requireUser();
    const url = new URL(request.url);
    const include = url.searchParams.get("include") ?? "";
    const targetId = asUserId(url.searchParams.get("userId")) ?? viewer.id;

    // Agents may only read their own profile.
    if (targetId !== viewer.id && !isStaff(viewer.role)) {
      return fail("You can only view your own profile", 403);
    }

    const [profile] = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        altPhone: users.altPhone,
        guardianPhone: users.guardianPhone,
        role: users.role,
        avatarUrl: users.avatarUrl,
        qualification: users.qualification,
        aboutPerson: users.aboutPerson,
        badges: users.badges,
        walletTotal: users.walletTotal,
        walletPending: users.walletPending,
        walletApproved: users.walletApproved,
        commissionPerDeal: users.commissionPerDeal,
        bankName: users.bankName,
        bankAccount: users.bankAccount,
        bankIfsc: users.bankIfsc,
        upiId: users.upiId,
        payoutLocked: users.payoutLocked,
        payoutLockedBy: users.payoutLockedBy,
        payoutLockedAt: users.payoutLockedAt,
        kycStatus: users.kycStatus,
        kycAadhaarUrl: users.kycAadhaarUrl,
        kycMarksheetUrl: users.kycMarksheetUrl,
        kycPhotoUrl: users.kycPhotoUrl,
        kycPanUrl: users.kycPanUrl,
        activeSeconds: users.activeSeconds,
        primaryNicheId: users.primaryNicheId,
        nicheName: niches.name,
        isOnline: users.isOnline,
        createdAt: users.createdAt,
      })
      .from(users)
      .leftJoin(niches, eq(niches.id, users.primaryNicheId))
      .where(eq(users.id, targetId))
      .limit(1);

    if (!profile) return fail("Profile not found", 404);

    const payload: Record<string, unknown> = {
      profile,
      viewer: { id: viewer.id, role: viewer.role, isSelf: targetId === viewer.id, canManage: isStaff(viewer.role) },
      payoutLocked: Boolean(profile.payoutLocked),
    };

    /* ---- KYC documents (supports up to 5 marksheets) ---- */
    payload.kycDocuments = await db
      .select({
        id: kycDocuments.id,
        kind: kycDocuments.kind,
        fileName: kycDocuments.fileName,
        url: kycDocuments.url,
        verified: kycDocuments.verified,
        uploadedAt: kycDocuments.uploadedAt,
      })
      .from(kycDocuments)
      .where(eq(kycDocuments.userId, targetId))
      .orderBy(desc(kycDocuments.uploadedAt));

    /* ---- daily activity snapshots ---- */
    const [history, today, totals] = await Promise.all([
      activityHistory(targetId, 30),
      activityToday(targetId),
      activityTotals(targetId),
    ]);
    payload.dailyActivity = history;
    payload.dailyLeadQuota = await getDailyQuota(targetId);
    payload.activityToday = today;
    payload.activityTotals = totals;

    /* ---- pipeline breakdown by stage ---- */
    payload.pipeline = await db
      .select({ status: leads.status, value: sql<number>`count(*)::int` })
      .from(leads)
      .where(eq(leads.assignedAgentId, targetId))
      .groupBy(leads.status);

    if (include.includes("earnings")) {
      const [deals, bonusRows, payouts, commission] = await Promise.all([
        db
          .select({
            id: dealApprovals.id,
            leadId: dealApprovals.leadId,
            businessName: leads.businessName,
            leadName: leads.contactName,
            city: leads.city,
            amount: dealApprovals.amount,
            commission: dealApprovals.commission,
            slabLabel: dealApprovals.slabLabel,
            bonusAmount: dealApprovals.bonusAmount,
            status: dealApprovals.status,
            proofUrl: dealApprovals.proofUrl,
            rejectionReason: dealApprovals.rejectionReason,
            reviewNote: dealApprovals.reviewNote,
            decidedAt: dealApprovals.decidedAt,
            createdAt: dealApprovals.createdAt,
          })
          .from(dealApprovals)
          .innerJoin(leads, eq(leads.id, dealApprovals.leadId))
          .where(eq(dealApprovals.agentId, targetId))
          .orderBy(desc(dealApprovals.createdAt))
          .limit(100),
        db
          .select({
            id: bonuses.id,
            amount: bonuses.amount,
            title: bonuses.title,
            note: bonuses.note,
            status: bonuses.status,
            createdAt: bonuses.createdAt,
          })
          .from(bonuses)
          .where(eq(bonuses.userId, targetId))
          .orderBy(desc(bonuses.createdAt))
          .limit(50),
        db.select().from(withdrawals).where(eq(withdrawals.userId, targetId)).orderBy(desc(withdrawals.createdAt)).limit(50),
        resolveAgentCommission(targetId),
      ]);

      payload.earnings = deals;
      payload.bonuses = bonusRows;
      payload.payouts = payouts;
      payload.commission = commission;
      payload.earningsSummary = {
        approvedCommission: deals.filter((d) => d.status === "APPROVED").reduce((s, d) => s + Number(d.commission), 0),
        pendingCommission: deals.filter((d) => d.status === "PENDING").reduce((s, d) => s + Number(d.commission), 0),
        rejectedCommission: deals.filter((d) => d.status === "REJECTED").reduce((s, d) => s + Number(d.commission), 0),
        bonusTotal: bonusRows.filter((b) => b.status === "APPROVED").reduce((s, b) => s + Number(b.amount), 0),
        approvedCount: deals.filter((d) => d.status === "APPROVED").length,
      };
    }

    return ok(payload);
  } catch (error) {
    return handleError(error);
  }
}

/** Agent updates their own (unlocked) payout + contact details, or uploads KYC. */
export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as Record<string, unknown>;
    const targetId = asUserId(body.userId) ?? user.id;
    if (targetId !== user.id && !isStaff(user.role)) return fail("Not permitted", 403);

    const [target] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
    if (!target) return fail("User not found", 404);

    const patch: Record<string, unknown> = {};

    /* ---- payout details: LOCKED once approved ---- */
    if (target.payoutLocked && !isStaff(user.role)) {
      const attempted = ["bankName", "bankAccount", "bankIfsc", "upiId"].some((k) => typeof body[k] === "string" && body[k]);
      if (attempted) {
        return fail(
          "Your bank / UPI details are approved and locked. Ask HR or Admin to unlock them before editing.",
          423,
        );
      }
    } else {
      for (const key of ["bankName", "bankAccount", "bankIfsc", "upiId"] as const) {
        if (typeof body[key] === "string") patch[key] = body[key];
      }
    }

    /* ---- contact + qualification ---- */
    for (const key of ["phone", "altPhone", "guardianPhone", "qualification"] as const) {
      if (typeof body[key] === "string") patch[key] = body[key];
    }

    /* ---- passport photo becomes the avatar ---- */
    if (typeof body.kycPhotoUrl === "string" && body.kycPhotoUrl) {
      patch.kycPhotoUrl = body.kycPhotoUrl;
      patch.avatarUrl = body.kycPhotoUrl;
      patch.kycStatus = "UNDER_REVIEW";
    }
    for (const key of ["kycAadhaarUrl", "kycMarksheetUrl", "kycPanUrl"] as const) {
      if (typeof body[key] === "string" && body[key]) {
        patch[key] = body[key];
        patch.kycStatus = "UNDER_REVIEW";
      }
    }

    /* ---- staff-only fields ---- */
    if (isStaff(user.role)) {
      if (typeof body.aboutPerson === "string") patch.aboutPerson = body.aboutPerson;
      if (Array.isArray(body.badges)) patch.badges = body.badges.map(String).slice(0, 12);
      if (typeof body.kycStatus === "string") patch.kycStatus = body.kycStatus.toUpperCase();
      if (typeof body.payoutLocked === "boolean") {
        patch.payoutLocked = body.payoutLocked;
        patch.payoutLockedBy = body.payoutLocked ? user.id : null;
        patch.payoutLockedAt = body.payoutLocked ? new Date() : null;
      }
      if (body.commissionPerDeal !== undefined) patch.commissionPerDeal = String(body.commissionPerDeal);
    }

    if (Object.keys(patch).length === 0) return ok({ updated: false });

    await db.update(users).set(patch).where(eq(users.id, targetId));
    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: "PROFILE_UPDATED",
      detail: `${target.name}: ${Object.keys(patch).join(", ")}`,
      meta: { targetId },
    });
    return ok({ updated: true, payoutLocked: patch.payoutLocked ?? target.payoutLocked });
  } catch (error) {
    return handleError(error);
  }
}

/** Withdrawal request (agent) — unchanged, still staff-approved. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as { amount?: number; method?: string; destination?: string; proofUrl?: string };
    const amount = Number(body.amount ?? 0);
    const [me] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
    if (!me) return fail("Profile missing", 404);
    if (amount <= 0) return fail("Enter a valid amount", 422);
    if (amount > Number(me.walletPending)) return fail("Amount exceeds pending balance", 422);

    const [row] = await db
      .insert(withdrawals)
      .values({
        userId: user.id,
        amount: String(amount),
        method: body.method ?? (me.upiId ? "UPI" : "BANK"),
        destination: body.destination ?? me.upiId ?? me.bankAccount,
        proofUrl: body.proofUrl ?? null,
        status: "PENDING",
      })
      .returning();
    await audit({ actorId: user.id, actorRole: user.role, action: "WITHDRAWAL_REQUESTED", detail: `₹${amount}` });
    return ok({ withdrawal: row });
  } catch (error) {
    return handleError(error);
  }
}

/** KYC document rows (marksheets etc.) — insert after upload. */
export async function PUT(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as { userId?: number; kind?: string; url?: string; fileName?: string; uploadId?: number };
    const targetId = asUserId(body.userId) ?? user.id;
    if (targetId !== user.id && !isStaff(user.role)) return fail("Not permitted", 403);
    if (!body.url || !body.kind) return fail("kind and url are required", 422);

    if (body.kind === "MARKSHEET") {
      const count = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(kycDocuments)
        .where(sql`${kycDocuments.userId} = ${targetId} and ${kycDocuments.kind} = 'MARKSHEET'`);
      if (Number(count[0]?.value ?? 0) >= 5) return fail("Maximum of 5 marksheet uploads reached", 409);
    }

    const [row] = await db
      .insert(kycDocuments)
      .values({
        userId: targetId,
        kind: body.kind.toUpperCase(),
        fileName: body.fileName ?? null,
        url: body.url,
        uploadId: body.uploadId ?? null,
      })
      .returning();

    await db.update(users).set({ kycStatus: "UNDER_REVIEW" }).where(eq(users.id, targetId));
    await audit({ actorId: user.id, actorRole: user.role, action: "KYC_UPLOADED", detail: body.kind });
    return ok({ document: row }, 201);
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE() {
  return ok({ forbidden: true, message: "Delete operations are not exposed to any role here" }, 403);
}
