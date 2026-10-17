import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { callLogs, leads, niches } from "@/db/schema";
import { handleError, ok, parseIntOr } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { getFieldPolicy, applyToLead, modeFor } from "@/lib/field-visibility";
import { ensureSeed } from "@/lib/seed";
import { hiddenNicheIds } from "@/lib/queries";

export const dynamic = "force-dynamic";

const AGENT_TABS = ["IN_PROGRESS", "CALLBACK", "NO_RESPONSE", "PAYMENT_APPROVAL", "REJECTED", "NEW"] as const;

export async function GET(request: Request) {
  try {
    await ensureSeed();
    const user = await requireUser();
    const url = new URL(request.url);
    const tab = (url.searchParams.get("tab") ?? "IN_PROGRESS").toUpperCase();
    const page = parseIntOr(url.searchParams.get("page"), 1);
    const pageSize = Math.min(parseIntOr(url.searchParams.get("pageSize"), 20), 100);
    const nicheId = parseIntOr(url.searchParams.get("nicheId"), 0);
    const q = (url.searchParams.get("q") ?? "").trim();

    const policy = await getFieldPolicy();

    // Niche visibility hard-lock: leads in a niche hidden from agents are removed
    // from the agent's workspace entirely — even if a stale id is posted.
    const hidden = await hiddenNicheIds();
    if (hidden.length > 0 && nicheId > 0 && hidden.includes(nicheId)) {
      return ok({
        page,
        pageSize,
        total: 0,
        totalPages: 1,
        rows: [],
        tabCounts: {},
        callsLogged: 0,
        fieldPolicy: {},
        nicheHidden: true,
      });
    }

    const filters = [
      eq(leads.assignedAgentId, user.id),
      eq(leads.archivedForAgent, false),
      inArray(leads.status, [...AGENT_TABS]),
    ];
    // always exclude hidden niches
    if (hidden.length > 0) filters.push(sql`${leads.nicheId} not in (${sql.join(hidden.map((id) => sql`${id}`), sql`, `)})`);
    if (nicheId > 0) filters.push(eq(leads.nicheId, nicheId));
    if (q) {
      filters.push(or(ilike(leads.businessName, `%${q}%`), ilike(leads.city, `%${q}%`), ilike(leads.phone, `%${q}%`))!);
    }
    const where = and(...filters);

    const [rows, totalRow, counts] = await Promise.all([
      db
        .select({
          id: leads.id,
          leadCode: leads.leadCode,
          businessName: leads.businessName,
          contactName: leads.contactName,
          phone: leads.phone,
          phoneNormalized: leads.phoneNormalized,
          gmapLink: leads.gmapLink,
          cityKeyword: leads.cityKeyword,
          city: leads.city,
          nicheId: leads.nicheId,
          nicheName: niches.name,
          nicheColor: niches.color,
          status: leads.status,
          callStatus: leads.callStatus,
          serviceStatus: leads.serviceStatus,
          websiteStatus: leads.websiteStatus,
          websiteUrl: leads.websiteUrl,
          opensAt: leads.opensAt,
          rating: leads.rating,
          reviewsCount: leads.reviewsCount,
          competitorName: leads.competitorName,
          competitorReviews: leads.competitorReviews,
          accessUnlocked: leads.accessUnlocked,
          callCount: leads.callCount,
          lastTouchedAt: leads.lastTouchedAt,
          assignedAt: leads.assignedAt,
          dealAmount: leads.dealAmount,
          commissionAmount: leads.commissionAmount,
        })
        .from(leads)
        .innerJoin(niches, eq(niches.id, leads.nicheId))
        .where(where)
        .orderBy(desc(sql`coalesce(${leads.lastTouchedAt}, ${leads.assignedAt})`), desc(leads.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ value: count() }).from(leads).where(where),
      db
        .select({ status: leads.status, value: count() })
        .from(leads)
        .where(
          and(
            eq(leads.assignedAgentId, user.id),
            eq(leads.archivedForAgent, false),
            inArray(leads.status, [...AGENT_TABS]),
            // tab badges must respect the sidebar niche selection + hidden niches
            hidden.length > 0 ? sql`${leads.nicheId} not in (${sql.join(hidden.map((id) => sql`${id}`), sql`, `)})` : undefined,
            nicheId > 0 ? eq(leads.nicheId, nicheId) : undefined,
            q ? or(ilike(leads.businessName, `%${q}%`), ilike(leads.city, `%${q}%`), ilike(leads.phone, `%${q}%`)) : undefined,
          ),
        )
        .groupBy(leads.status),
    ]);

    const projected = rows.map((r) => ({
      ...applyToLead(r as unknown as Record<string, unknown>, policy, user.role),
      // engine metadata (never policy-controlled)
      id: r.id,
      nicheId: r.nicheId,
      nicheColor: r.nicheColor,
      accessUnlocked: r.accessUnlocked,
      callCount: r.callCount,
      lastTouchedAt: r.lastTouchedAt,
      assignedAt: r.assignedAt,
      dealAmount: r.dealAmount,
      commissionAmount: r.commissionAmount,
      // dialer gating: agent may only dial when phone is VISIBLE or MASKED (masked still dials)
      canDial: modeFor(policy, "phone", user.role) !== "HIDDEN",
      dialTarget: modeFor(policy, "phone_normalized", user.role) === "HIDDEN" ? r.phone : r.phoneNormalized ?? r.phone,
    }));

    const tabCounts = Object.fromEntries(counts.map((c) => [c.status, Number(c.value)])) as Record<string, number>;

    const [walletRow] = await db
      .select({ pending: sql<number>`count(*)::int` })
      .from(callLogs)
      .where(and(eq(callLogs.agentId, user.id), sql`${callLogs.callEndedAt} is not null`));

    return ok({
      page,
      pageSize,
      total: Number(totalRow[0]?.value ?? 0),
      totalPages: Math.max(1, Math.ceil(Number(totalRow[0]?.value ?? 0) / pageSize)),
      rows: projected,
      tabCounts,
      callsLogged: Number(walletRow?.pending ?? 0),
      fieldPolicy: Object.fromEntries(
        Object.keys(policy)
          .filter((k) => modeFor(policy, k, user.role) !== "VISIBLE")
          .map((k) => [k, modeFor(policy, k, user.role)]),
      ),
    });
  } catch (error) {
    return handleError(error);
  }
}
