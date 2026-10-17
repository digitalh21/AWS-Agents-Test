import { and, asc, count, desc, eq, gt, ilike, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { callLogs, leads, niches, users } from "@/db/schema";
import { audit, handleError, ok, parseIntOr } from "@/lib/api";
import { asUserId, requireStaff } from "@/lib/auth";
import { DEFAULT_PAGESIZE } from "@/lib/rbac";
import { nicheOptions } from "@/lib/queries";
import { applyToLead, getFieldPolicy, modeFor } from "@/lib/field-visibility";
import { ensureSeed } from "@/lib/seed";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await ensureSeed();
    await requireStaff();
    const staff = await requireStaff();
    const url = new URL(request.url);
    const page = parseIntOr(url.searchParams.get("page"), 1);
    const pageSize = Math.min(parseIntOr(url.searchParams.get("pageSize"), DEFAULT_PAGESIZE), 500);
    const nicheId = parseIntOr(url.searchParams.get("nicheId"), 0);
    const status = url.searchParams.get("status") ?? "";
    const agentId = asUserId(url.searchParams.get("agentId"));
    const q = (url.searchParams.get("q") ?? "").trim();
    const view = url.searchParams.get("view") ?? "table";
    const sort = url.searchParams.get("sort") ?? "recent";

    const filters = [];
    if (nicheId > 0) filters.push(eq(leads.nicheId, nicheId));
    if (status && status !== "ALL") filters.push(status === "UNASSIGNED" ? sql`${leads.assignedAgentId} is null` : eq(leads.status, status));
    if (agentId) filters.push(eq(leads.assignedAgentId, agentId));
    if (q) {
      filters.push(
        or(ilike(leads.businessName, `%${q}%`), ilike(leads.phone, `%${q}%`), ilike(leads.city, `%${q}%`))!,
      );
    }
    const where = filters.length ? and(...filters) : undefined;

    const orderBy =
      sort === "reviews"
        ? [desc(leads.reviewsCount)]
        : sort === "business"
          ? [asc(leads.businessName)]
          : [desc(leads.updatedAt), desc(leads.id)];

    const policy = await getFieldPolicy();

    const baseSelect = {
      id: leads.id,
      leadCode: leads.leadCode,
      gmapLink: leads.gmapLink,
      cityKeyword: leads.cityKeyword,
      opensAt: leads.opensAt,
      phoneNormalized: leads.phoneNormalized,
      websiteStatus: leads.websiteStatus,
      websiteUrl: leads.websiteUrl,
      serviceStatus: leads.serviceStatus,
      callStatus: leads.callStatus,
      businessName: leads.businessName,
      contactName: leads.contactName,
      phone: leads.phone,
      city: leads.city,
      status: leads.status,
      rating: leads.rating,
      reviewsCount: leads.reviewsCount,
      competitorName: leads.competitorName,
      competitorReviews: leads.competitorReviews,
      nicheId: leads.nicheId,
      nicheName: niches.name,
      assignedAgentId: leads.assignedAgentId,
      agentName: users.name,
      accessUnlocked: leads.accessUnlocked,
      callCount: leads.callCount,
      dealAmount: leads.dealAmount,
      commissionAmount: leads.commissionAmount,
      lastTouchedAt: leads.lastTouchedAt,
      updatedAt: leads.updatedAt,
      createdAt: leads.createdAt,
      batchId: leads.batchId,
    };

    const [rows, totalRow, statusCounts, nicheRows] = await Promise.all([
      db
        .select(baseSelect)
        .from(leads)
        .innerJoin(niches, eq(niches.id, leads.nicheId))
        .leftJoin(users, eq(users.id, leads.assignedAgentId))
        .where(where)
        .orderBy(...orderBy)
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ value: count() }).from(leads).where(where),
      db
        .select({ status: leads.status, value: count() })
        .from(leads)
        .where(where ?? sql`true`)
        .groupBy(leads.status),
      nicheOptions(),
    ]);

    // Metrics respect the sidebar niche selection so the header always matches the board.
    const [globalStats] = await db
      .select({
        total: sql<number>`count(*)::int`,
        unassigned: sql<number>`count(*) filter (where ${leads.assignedAgentId} is null)::int`,
        closed: sql<number>`count(*) filter (where ${leads.status} = 'CLOSED')::int`,
        paymentPending: sql<number>`count(*) filter (where ${leads.status} = 'PAYMENT_APPROVAL')::int`,
        revenue: sql<number>`coalesce(sum(${leads.dealAmount}), 0)::float`,
      })
      .from(leads)
      .where(where ?? sql`true`);

    const agents = await db
      .select({
        id: users.id,
        name: users.name,
        role: users.role,
        isOnline: users.isOnline,
        activeLeadCount: sql<number>`(select count(*) from ${leads} where ${leads.assignedAgentId} = ${users.id})::int`,
      })
      .from(users)
      .where(inArray(users.role, ["AGENT", "MANAGER", "HR", "ADMIN"]))
      .orderBy(users.name);

    const [callStats] = await db
      .select({
        totalCalls: sql<number>`count(*)::int`,
        talkSeconds: sql<number>`coalesce(sum(${callLogs.durationSeconds}), 0)::int`,
      })
      .from(callLogs)
      .where(
        nicheId > 0
          ? and(isNotNull(callLogs.callEndedAt), sql`${callLogs.leadId} in (select id from ${leads} where ${leads.nicheId} = ${nicheId})`)
          : isNotNull(callLogs.callEndedAt),
      );

    const projectedRows = rows.map((r) => ({
      ...applyToLead(r as unknown as Record<string, unknown>, policy, staff.role),
      id: r.id,
      nicheId: r.nicheId,
      assignedAgentId: r.assignedAgentId,
      accessUnlocked: r.accessUnlocked,
      callCount: r.callCount,
      dealAmount: r.dealAmount,
      lastTouchedAt: r.lastTouchedAt,
      updatedAt: r.updatedAt,
      createdAt: r.createdAt,
      batchId: r.batchId,
    }));

    return ok({
      page,
      pageSize,
      total: Number(totalRow[0]?.value ?? 0),
      totalPages: Math.max(1, Math.ceil(Number(totalRow[0]?.value ?? 0) / pageSize)),
      rows: projectedRows,
      statusCounts: Object.fromEntries(statusCounts.map((s) => [s.status, Number(s.value)])),
      niches: nicheRows,
      agents,
      globalStats: {
        ...globalStats,
        ...callStats,
      },
      view,
      fieldPolicy: Object.fromEntries(
        Object.keys(policy)
          .filter((k) => modeFor(policy, k, staff.role) !== "VISIBLE")
          .map((k) => [k, modeFor(policy, k, staff.role)]),
      ),
    });
  } catch (error) {
    return handleError(error);
  }
}


