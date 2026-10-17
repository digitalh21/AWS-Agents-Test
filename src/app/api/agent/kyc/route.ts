import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { kycDocuments, notifications, users } from "@/db/schema";
import { audit, fail, handleError, ok } from "@/lib/api";
import { asUserId, isStaff, requireStaff, requireUser } from "@/lib/auth";
import { emitDecisionNotice } from "@/lib/decisions";
import { ensureTables } from "@/db/bootstrap";

export const dynamic = "force-dynamic";

/** GET ?userId= -> KYC documents + overall status (staff or self). */
export async function GET(request: Request) {
  try {
    await ensureTables();
    const viewer = await requireUser();
    const url = new URL(request.url);
    const targetId = asUserId(url.searchParams.get("userId")) ?? viewer.id;
    if (targetId !== viewer.id && !isStaff(viewer.role)) return fail("Not permitted", 403);

    const [docs, profile] = await Promise.all([
      db.select().from(kycDocuments).where(eq(kycDocuments.userId, targetId)).orderBy(desc(kycDocuments.uploadedAt)),
      db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          kycStatus: users.kycStatus,
          kycAadhaarUrl: users.kycAadhaarUrl,
          kycMarksheetUrl: users.kycMarksheetUrl,
          kycPhotoUrl: users.kycPhotoUrl,
          kycPanUrl: users.kycPanUrl,
        })
        .from(users)
        .where(eq(users.id, targetId))
        .limit(1),
    ]);

    return ok({ documents: docs, profile: profile[0] ?? null, viewer: { id: viewer.id, isStaff: isStaff(viewer.role) } });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * PATCH /api/agent/kyc
 * Staff: { documentId?, status: APPROVED|REJECTED, reason?, userId?, level? }
 * Agent: { resubmit: true, documentId?, url?, fileName? } -> re-upload after rejection
 */
export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as {
      userId?: number;
      documentId?: number;
      status?: string;
      reason?: string;
      level?: string;
      resubmit?: boolean;
      url?: string;
      fileName?: string;
    };
    await ensureTables();

    /* ---------------- agent re-upload / re-submit ---------------- */
    if (body.resubmit) {
      const targetId = asUserId(body.userId) ?? user.id;
      if (targetId !== user.id && !isStaff(user.role)) return fail("Not permitted", 403);
      if (!body.url) return fail("Upload the replacement file first", 422);

      if (body.documentId) {
        await db
          .update(kycDocuments)
          .set({ url: body.url, fileName: body.fileName ?? null, verified: false, uploadedAt: new Date() })
          .where(and(eq(kycDocuments.id, Number(body.documentId)), eq(kycDocuments.userId, targetId)));
      } else {
        await db.insert(kycDocuments).values({
          userId: targetId,
          kind: (body.level ?? "OTHER").toUpperCase(),
          fileName: body.fileName ?? null,
          url: body.url,
        });
      }

      await db.update(users).set({ kycStatus: "UNDER_REVIEW" }).where(eq(users.id, targetId));
      await audit({ actorId: user.id, actorRole: user.role, action: "KYC_RESUBMITTED", detail: body.level ?? "document" });

      return ok({ ok: true, resubmitted: true, kycStatus: "UNDER_REVIEW" });
    }

    /* ---------------- staff approve / reject ---------------- */
    const staff = await requireStaff();
    const status = String(body.status ?? "").toUpperCase();
    if (!["APPROVED", "REJECTED", "UNDER_REVIEW"].includes(status)) return fail("status must be APPROVED, REJECTED or UNDER_REVIEW", 422);
    if (status === "REJECTED" && !(body.reason && body.reason.trim().length >= 5)) {
      return fail("A rejection reason (min 5 characters) is required — the agent will see it in a popup.", 422);
    }

    const targetId = asUserId(body.userId);
    if (!targetId) return fail("userId is required", 422);
    const [agent] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
    if (!agent) return fail("Agent not found", 404);

    const reason = body.reason?.trim() ?? null;

    // single document verdict
    if (body.documentId) {
      await db
        .update(kycDocuments)
        .set({ verified: status === "APPROVED" })
        .where(eq(kycDocuments.id, Number(body.documentId)));
    }

    await db.update(users).set({ kycStatus: status }).where(eq(users.id, targetId));

    await db.insert(notifications).values({
      title: status === "APPROVED" ? "KYC approved ✅" : "KYC rejected ❌",
      body:
        status === "APPROVED"
          ? "Your KYC documents have been verified and approved."
          : `Your KYC documents were rejected. Reason: ${reason}. Please re-upload and re-submit.`,
      audienceRole: "ALL",
      targetUserId: targetId,
      sentBy: staff.id,
    });

    // AUTOMATED AGENT POPUP — KYC verdict + rejection reason
    await emitDecisionNotice({
      userId: targetId,
      kind: "KYC",
      status: status === "APPROVED" ? "APPROVED" : "REJECTED",
      title:
        status === "APPROVED"
          ? "KYC verification approved ✅"
          : "KYC verification rejected ❌",
      message:
        status === "APPROVED"
          ? "Your KYC documents passed verification. Your profile is now fully verified."
          : "Your KYC documents did not pass verification. Please re-upload and re-submit from your profile.",
      notes: reason,
      entityId: body.documentId ?? null,
      actorName: staff.name,
    });

    await audit({
      actorId: staff.id,
      actorRole: staff.role,
      action: status === "APPROVED" ? "KYC_APPROVED" : "KYC_REJECTED",
      detail: `${agent.name}: ${reason ?? "no reason"}`,
      meta: { targetId, documentId: body.documentId ?? null },
    });

    return ok({ ok: true, kycStatus: status, reason });
  } catch (error) {
    return handleError(error);
  }
}
