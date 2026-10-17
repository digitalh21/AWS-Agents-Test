import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { leadErrorReports, leads, notifications, users } from "@/db/schema";
import { audit, fail, handleError, ok } from "@/lib/api";
import { isStaff, requireStaff, requireUser } from "@/lib/auth";
import { emitDecisionNotice } from "@/lib/decisions";
import { ensureSeed } from "@/lib/seed";

export const dynamic = "force-dynamic";

export const ERROR_CATEGORIES = [
  { value: "WRONG_NUMBER", label: "Wrong / Invalid Number" },
  { value: "DUPLICATE", label: "Duplicate Lead" },
  { value: "CLOSED_BUSINESS", label: "Business Permanently Closed" },
  { value: "WRONG_DATA", label: "Incorrect Business Data" },
  { value: "DO_NOT_CALL", label: "Asked Not To Be Called" },
  { value: "OTHER", label: "Other Issue" },
] as const;

/** GET: agents see their own reports, staff see the full queue. */
export async function GET(request: Request) {
  try {
    await ensureSeed();
    const user = await requireUser();
    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") ?? "ALL";
    const leadId = Number(url.searchParams.get("leadId") ?? 0);

    const rows = await db
      .select({
        id: leadErrorReports.id,
        leadId: leadErrorReports.leadId,
        businessName: leads.businessName,
        leadCode: leads.leadCode,
        leadPhone: leads.phone,
        leadStatus: leads.status,
        reporterId: leadErrorReports.userId,
        reporterName: users.name,
        reporterRole: users.role,
        category: leadErrorReports.category,
        details: leadErrorReports.details,
        proofUrl: leadErrorReports.proofUrl,
        status: leadErrorReports.status,
        resolution: leadErrorReports.resolution,
        actionTaken: leadErrorReports.actionTaken,
        createdAt: leadErrorReports.createdAt,
        decidedAt: leadErrorReports.decidedAt,
      })
      .from(leadErrorReports)
      .innerJoin(leads, eq(leads.id, leadErrorReports.leadId))
      .innerJoin(users, eq(users.id, leadErrorReports.userId))
      .where(
        and(
          isStaff(user.role) ? undefined : eq(leadErrorReports.userId, user.id),
          scope === "ALL" ? undefined : eq(leadErrorReports.status, scope),
          leadId ? eq(leadErrorReports.leadId, leadId) : undefined,
        ),
      )
      .orderBy(desc(leadErrorReports.createdAt))
      .limit(100);

    const [counts] = await db
      .select({
        pending: sql<number>`count(*) filter (where ${leadErrorReports.status} = 'PENDING')::int`,
        resolved: sql<number>`count(*) filter (where ${leadErrorReports.status} = 'RESOLVED')::int`,
        rejected: sql<number>`count(*) filter (where ${leadErrorReports.status} = 'REJECTED')::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(leadErrorReports);

    return ok({
      rows,
      counts: {
        pending: Number(counts?.pending ?? 0),
        resolved: Number(counts?.resolved ?? 0),
        rejected: Number(counts?.rejected ?? 0),
        total: Number(counts?.total ?? 0),
      },
      categories: ERROR_CATEGORIES,
      viewer: { id: user.id, role: user.role, isStaff: isStaff(user.role) },
    });
  } catch (error) {
    return handleError(error);
  }
}

/** POST: agent files a lead error report. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as {
      leadId?: number;
      category?: string;
      details?: string;
      proofUrl?: string;
    };
    const leadId = Number(body.leadId ?? 0);
    const details = (body.details ?? "").trim();
    if (!leadId) return fail("leadId is required", 422);
    if (details.length < 10) return fail("Please describe the issue in at least 10 characters", 422);

    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    if (!lead) return fail("Lead not found", 404);
    // Agents may only report leads on their own queue.
    if (!isStaff(user.role) && lead.assignedAgentId !== user.id) {
      return fail("This lead is not assigned to you", 403);
    }

    const [row] = await db
      .insert(leadErrorReports)
      .values({
        leadId,
        userId: user.id,
        category: body.category ?? "OTHER",
        details,
        proofUrl: body.proofUrl ?? null,
        status: "PENDING",
      })
      .returning();

    await db.insert(notifications).values({
      title: "Lead error reported",
      body: `${user.name} reported an issue on ${lead.businessName} (${lead.leadCode ?? `#${leadId}`}).`,
      audienceRole: "ALL",
      sentBy: user.id,
    });

    await audit({
      actorId: user.id,
      actorRole: user.role,
      leadId,
      action: "LEAD_ERROR_REPORTED",
      detail: `${body.category ?? "OTHER"}: ${details.slice(0, 120)}`,
      meta: { reportId: row!.id },
    });

    return ok({ report: row }, 201);
  } catch (error) {
    return handleError(error);
  }
}

/** PATCH: staff resolve / reject, optionally taking an action on the lead. */
export async function PATCH(request: Request) {
  try {
    const staff = await requireStaff();
    const body = (await request.json()) as {
      id?: number;
      action?: string;
      resolution?: string;
      leadAction?: string;
    };
    const id = Number(body.id ?? 0);
    const approve = String(body.action ?? "").toUpperCase() === "RESOLVE";
    const resolution = body.resolution ?? null;
    const leadAction = body.leadAction ?? "NONE";
    if (!id) return fail("id required", 422);

    const [report] = await db.select().from(leadErrorReports).where(eq(leadErrorReports.id, id)).limit(1);
    if (!report) return fail("Report not found", 404);
    if (report.status !== "PENDING") return fail("Report already reviewed", 409);

    const [lead] = await db.select().from(leads).where(eq(leads.id, report.leadId)).limit(1);

    // Optional corrective action on the lead itself.
    if (approve && lead) {
      if (leadAction === "LEAD_UNASSIGNED") {
        await db
          .update(leads)
          .set({ assignedAgentId: null, assignedAt: null, accessUnlocked: false, updatedAt: new Date() })
          .where(eq(leads.id, lead.id));
      } else if (leadAction === "MARKED_DO_NOT_CALL") {
        await db.update(leads).set({ status: "REJECTED", updatedAt: new Date() }).where(eq(leads.id, lead.id));
      }
    }

    await db
      .update(leadErrorReports)
      .set({
        status: approve ? "RESOLVED" : "REJECTED",
        resolution,
        actionTaken: approve ? leadAction : "NONE",
        reviewedBy: staff.id,
        decidedAt: new Date(),
      })
      .where(eq(leadErrorReports.id, id));

    await db.insert(notifications).values({
      title: approve ? "Lead error resolved ✅" : "Lead error report rejected",
      body: approve
        ? `Your report on ${lead?.businessName ?? `lead #${report.leadId}`} was resolved. ${resolution ?? ""}`
        : `Your report on ${lead?.businessName ?? `lead #${report.leadId}`} was rejected. ${resolution ?? ""}`,
      audienceRole: "ALL",
      targetUserId: report.userId,
      sentBy: staff.id,
    });

    await audit({
      actorId: staff.id,
      actorRole: staff.role,
      leadId: report.leadId,
      action: approve ? "LEAD_ERROR_RESOLVED" : "LEAD_ERROR_REJECTED",
      detail: resolution ?? "",
      meta: { reportId: id, leadAction },
    });

    await emitDecisionNotice({
      userId: report.userId,
      kind: "LEAD_ERROR",
      status: approve ? "APPROVED" : "REJECTED",
      title: approve ? "Lead error report resolved ✅" : "Lead error report rejected ❌",
      message: approve
        ? `Your error report on ${lead?.businessName ?? `lead #${report.leadId}`} was reviewed and resolved.`
        : `Your error report on ${lead?.businessName ?? `lead #${report.leadId}`} was rejected after review.`,
      notes: resolution,
      leadId: report.leadId,
      entityId: id,
      actorName: staff.name,
    } as never);

    return ok({ ok: true, status: approve ? "RESOLVED" : "REJECTED" });
  } catch (error) {
    return handleError(error);
  }
}
