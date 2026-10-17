import { and, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { leads, niches, users } from "@/db/schema";
import { fail, handleError } from "@/lib/api";
import { getSessionUser, isStaff } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/leads/export?format=csv|xls&nicheId=&status=&agentId=&q=
 *
 * "Download Leads" for MANAGEMENT only (ADMIN | HR | MANAGER) — exports the
 * FULL filtered result set (not just the visible page), capped at 50k rows.
 * format=csv -> text/csv, comma separated
 * format=xls -> application/vnd.ms-excel, tab separated (opens natively in Excel)
 */
export async function GET(request: Request) {
  try {
    const staff = await getSessionUser();
    if (!staff) return fail("Not authenticated", 401);
    if (!isStaff(staff.role)) return fail("Management/Admin only", 403);

    const url = new URL(request.url);
    const format = url.searchParams.get("format") === "xls" ? "xls" : "csv";
    const sep = format === "xls" ? "\t" : ",";

    const nicheId = Number(url.searchParams.get("nicheId") ?? 0) || 0;
    const status = (url.searchParams.get("status") ?? "").toUpperCase();
    const agentId = url.searchParams.get("agentId") ?? "";
    const q = (url.searchParams.get("q") ?? "").trim();

    const filters: never[] = [];
    if (nicheId) filters.push(eq(leads.nicheId, nicheId) as never);
    if (status && status !== "ALL") {
      filters.push(
        (status === "UNASSIGNED" ? isNull(leads.assignedAgentId) : eq(leads.status, status)) as never,
      );
    }
    if (agentId) filters.push(eq(leads.assignedAgentId, agentId) as never);
    if (q) {
      filters.push(
        or(
          ilike(leads.businessName, `%${q}%`),
          ilike(leads.phone, `%${q}%`),
          ilike(leads.city, `%${q}%`),
          ilike(leads.leadCode, `%${q}%`),
        ) as never,
      );
    }

    const rows = await db
      .select({
        leadCode: leads.leadCode,
        businessName: leads.businessName,
        contactName: leads.contactName,
        phone: leads.phone,
        mobileNo: leads.mobileNo,
        email: leads.email,
        city: leads.city,
        cityKeyword: leads.cityKeyword,
        niche: niches.name,
        nicheCategory: leads.nicheCategory,
        pipelineStatus: leads.status,
        leadStatus: leads.leadStatus,
        callStatus: leads.callStatus,
        websiteStatus: leads.websiteStatus,
        serviceStatus: leads.serviceStatus,
        statusService: leads.statusService,
        backendCheck: leads.backendCheck,
        rating: leads.rating,
        reviews: sql<number>`coalesce(${leads.reviews}, ${leads.reviewsCount})`,
        websiteUrl: leads.websiteUrl,
        gmapLink: leads.gmapLink,
        opensAt: leads.opensAt,
        dealAmount: leads.dealAmount,
        leadCloseAmount: leads.leadCloseAmount,
        callCount: leads.callCount,
        assignedAgent: users.name,
        assignedAgentId: leads.assignedAgentId,
        assignedAt: leads.assignedAt,
        createdAt: leads.createdAt,
      })
      .from(leads)
      .leftJoin(niches, eq(niches.id, leads.nicheId))
      .leftJoin(users, eq(users.id, leads.assignedAgentId))
      .where(filters.length ? (and(...filters) as never) : undefined)
      .orderBy(desc(leads.id))
      .limit(50_000);

    const header = [
      "Lead Code", "Business Name", "Contact", "Phone", "Mobile", "Email", "City", "City Keyword",
      "Niche", "Niche Category", "Pipeline Status", "Lead Status", "Call Status", "Website Status",
      "Service Status", "Status Service", "Backend Check", "Rating", "Reviews", "Website", "GMaps Link",
      "Opens At", "Deal Amount", "Close Amount", "Calls", "Assigned Agent", "Assigned At", "Created At",
    ];

    const cell = (v: unknown) => {
      if (v === null || v === undefined) return "";
      const str = v instanceof Date ? v.toISOString() : String(v);
      if (str.includes('"') || str.includes(sep) || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const lines = [header.join(sep)];
    for (const r of rows) {
      lines.push(
        [
          r.leadCode, r.businessName, r.contactName, r.phone, r.mobileNo, r.email, r.city, r.cityKeyword,
          r.niche, r.nicheCategory, r.pipelineStatus, r.leadStatus, r.callStatus, r.websiteStatus,
          r.serviceStatus, r.statusService, r.backendCheck ? "yes" : "no", r.rating, r.reviews, r.websiteUrl,
          r.gmapLink, r.opensAt, r.dealAmount, r.leadCloseAmount, r.callCount,
          r.assignedAgent ?? "Pool", r.assignedAt, r.createdAt,
        ]
          .map(cell)
          .join(sep),
      );
    }

    const csv = lines.join("\r\n");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const filename = `auto-growth-leads-${stamp}.${format === "xls" ? "xls" : "csv"}`;
    const mime =
      format === "xls" ? "application/vnd.ms-excel; charset=utf-8" : "text/csv; charset=utf-8";

    return new Response("" + csv, {
      headers: {
        "Content-Type": mime,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Row-Count": String(rows.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
