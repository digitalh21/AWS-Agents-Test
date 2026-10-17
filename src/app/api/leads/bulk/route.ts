import { and, eq, isNull, sql, inArray } from "drizzle-orm";
import { db } from "@/db";
import { leads, niches, users } from "@/db/schema";
import { audit, fail, handleError, ok } from "@/lib/api";
import { asUserId, requireStaff } from "@/lib/auth";
import { recordLeadHistory } from "@/lib/lead-history";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ParsedLead = {
  leadCode: string | null;
  nicheId: number;
  businessName: string;
  contactName: string | null;
  phone: string;
  phoneNormalized: string | null;
  gmapLink: string | null;
  cityKeyword: string | null;
  city: string | null;
  opensAt: string | null;
  websiteStatus: string | null;
  websiteUrl: string | null;
  serviceStatus: string | null;
  callStatus: string | null;
  email: string | null;
  address: string | null;
  rating: string;
  reviewsCount: number;
  competitorName: string | null;
  competitorReviews: number;
  status: string;
};

function splitCsvLine(line: string) {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      quoted = !quoted;
    } else if (ch === "," && !quoted) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

/** CSV / bulk upload (5K-10K batch) + auto-assign + synthetic generator */
export async function POST(request: Request) {
  try {
    const staff = await requireStaff();
    const contentType = request.headers.get("content-type") ?? "";
    let mode = "csv";
    let nicheId = 0;
    let autoAssign = true;
    let count = 0;
    let csvText = "";

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      mode = String(form.get("mode") ?? "csv");
      nicheId = Number(form.get("nicheId") ?? 0);
      autoAssign = String(form.get("autoAssign") ?? "true") === "true";
      count = Number(form.get("count") ?? 0);
      const file = form.get("file");
      if (file instanceof File) csvText = await file.text();
    } else {
      const body = (await request.json()) as Record<string, unknown>;
      mode = String(body.mode ?? "csv");
      nicheId = Number(body.nicheId ?? 0);
      autoAssign = body.autoAssign !== false;
      count = Number(body.count ?? 0);
      csvText = String(body.csv ?? "");
    }

    /* ---------------- synthetic generator: DISABLED (no mock data) ---------------- */
    if (mode === "generate") {
      return fail(
        "Synthetic lead generation is disabled. Use CSV import or create leads through the app.",
        400,
      );
    }

    /* ---------------- CSV batch import ---------------- */
    const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return fail("CSV is empty", 422);
    const maxRows = Math.min(lines.length, 10_000);
    const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
    const hasHeader = header.includes("business_name") || header.includes("phone");
    const colIndex = (name: string) => header.indexOf(name);
    // All 14 custom lead fields (+ email/address) mapped by CSV header name.
    const idx = {
      leadCode: hasHeader ? colIndex("lead_code") : -1,
      business: hasHeader ? colIndex("business_name") : 0,
      phone: hasHeader ? colIndex("phone") : 1,
      contact: hasHeader ? colIndex("contact_name") : 2,
      city: hasHeader ? colIndex("city_keyword") : 3,
      cityAlt: hasHeader ? colIndex("city") : -1,
      gmapLink: hasHeader ? colIndex("gmap_link") : -1,
      rating: hasHeader ? colIndex("rating") : 4,
      reviews: hasHeader ? colIndex("reviews_count") : 5,
      competitor: hasHeader ? colIndex("competitor_name") : 6,
      competitorReviews: hasHeader ? colIndex("competitor_reviews") : 7,
      niche: hasHeader ? colIndex("niche") : hasHeader ? colIndex("niche_category") : -1,
      opensAt: hasHeader ? colIndex("opens_at") : -1,
      phoneNormalized: hasHeader ? colIndex("phone_normalized") : -1,
      websiteStatus: hasHeader ? colIndex("website_status") : -1,
      websiteUrl: hasHeader ? colIndex("website_url") : -1,
      serviceStatus: hasHeader ? colIndex("service_status") : -1,
      callStatus: hasHeader ? colIndex("call_status") : -1,
      email: hasHeader ? colIndex("email") : -1,
      address: hasHeader ? colIndex("address") : -1,
      status: hasHeader ? colIndex("status") : -1,
    };
    const pick = (rowCells: string[], i: number) => (i >= 0 ? (rowCells[i] ?? "").trim() : "");

    const nicheRows = await db.select({ id: niches.id, name: niches.name, slug: niches.slug }).from(niches);
    const findNiche = (value: string) => {
      if (!value) return nicheId;
      const needle = value.toLowerCase().trim();
      const found = nicheRows.find((n) => n.name.toLowerCase() === needle || n.slug === needle);
      return found?.id ?? nicheId;
    };

    const agents = await db
      .select({ id: users.id, primaryNicheId: users.primaryNicheId })
      .from(users)
      .where(and(eq(users.role, "AGENT"), eq(users.isActive, true)))
      .orderBy(users.id);

    const batchId = `CSV-${Date.now()}`;
    const rows: ParsedLead[] = [];
    let skipped = 0;

    for (let i = hasHeader ? 1 : 0; i < maxRows; i += 1) {
      const cells = splitCsvLine(lines[i]);
      const businessName = cells[idx.business] ?? "";
      const phone = (cells[idx.phone] ?? "").replace(/[^0-9]/g, "");
      if (!businessName || phone.length < 10) {
        skipped += 1;
        continue;
      }
      const cityVal = pick(cells, idx.city) || pick(cells, idx.cityAlt) || null;
      const phoneNorm = pick(cells, idx.phoneNormalized) || `91${phone.slice(-10)}`;
      const rawStatus = pick(cells, idx.status).toUpperCase().replace(/\s+/g, "_");
      const validStatus = ["NEW","IN_PROGRESS","CALLBACK","NO_RESPONSE","REJECTED","PAYMENT_APPROVAL","CLOSED"].includes(rawStatus)
        ? rawStatus
        : "NEW";

      rows.push({
        leadCode: pick(cells, idx.leadCode) || null,
        nicheId: idx.niche >= 0 ? findNiche(pick(cells, idx.niche)) || nicheRows[0]?.id || 1 : nicheId || nicheRows[0]?.id || 1,
        businessName,
        contactName: pick(cells, idx.contact) || null,
        phone,
        phoneNormalized: phoneNorm,
        gmapLink: pick(cells, idx.gmapLink) || null,
        cityKeyword: pick(cells, idx.city) || null,
        city: cityVal,
        opensAt: pick(cells, idx.opensAt) || null,
        websiteStatus: pick(cells, idx.websiteStatus) || null,
        websiteUrl: pick(cells, idx.websiteUrl) || null,
        serviceStatus: pick(cells, idx.serviceStatus) || null,
        callStatus: pick(cells, idx.callStatus) || "Not Dialed",
        email: pick(cells, idx.email) || null,
        address: pick(cells, idx.address) || null,
        rating: String(Number(pick(cells, idx.rating) || 0) || 0),
        reviewsCount: Number(pick(cells, idx.reviews) || 0) || 0,
        competitorName: pick(cells, idx.competitor) || null,
        competitorReviews: Number(pick(cells, idx.competitorReviews) || 0) || 0,
        status: validStatus,
      });
    }

    let inserted = 0;
    let assigned = 0;
    const CHUNK = 1000;
    for (let start = 0; start < rows.length; start += CHUNK) {
      const chunk = rows.slice(start, start + CHUNK).map((r, i) => ({
        ...r,
        assignedAgentId:
          autoAssign && agents.length > 0 ? agents[(start + i) % agents.length]!.id : null,
        assignedAt: autoAssign && agents.length > 0 ? new Date() : null,
        batchId,
      }));
      const res = await db.insert(leads).values(chunk).returning({ id: leads.id, agentId: leads.assignedAgentId });
      inserted += res.length;
      assigned += res.filter((r) => r.agentId).length;
    }

    await audit({
      actorId: staff.id,
      actorRole: staff.role,
      action: "BULK_CSV_IMPORT",
      detail: `inserted=${inserted}, skipped=${skipped}, assigned=${assigned}`,
      meta: { batchId },
    });

    const [{ total: all }] = await db.select({ total: sql<number>`count(*)::int` }).from(leads);
    const [{ pool }] = await db
      .select({ pool: sql<number>`count(*)::int` })
      .from(leads)
      .where(isNull(leads.assignedAgentId));

    return ok({ inserted, skipped, assigned, batchId, totalLeads: Number(all), pool: Number(pool) });
  } catch (error) {
    return handleError(error);
  }
}

/** Round-robin auto-assign of unassigned pool leads, honouring per-agent daily quotas. */
export async function PATCH(request: Request) {
  try {
    const staff = await requireStaff();
    const body = (await request.json().catch(() => ({}))) as { limit?: number; nicheId?: number; respectQuota?: boolean };
    const limit = Math.max(1, Math.min(20000, Number(body.limit ?? 100)));
    // Per Day Lead Limit is a HARD ceiling for auto-allocation (no bypass).
    const respectQuota = true;
    void (body as { respectQuota?: boolean }).respectQuota;

    // Active agents with their niche preference and manual daily quota.
    const agents = await db
      .select({ id: users.id, name: users.name, primaryNicheId: users.primaryNicheId, dailyLeadQuota: users.dailyLeadQuota, dailyLeadLimit: users.dailyLeadLimit })
      .from(users)
      .where(and(eq(users.role, "AGENT"), eq(users.isActive, true)))
      .orderBy(users.id);
    if (agents.length === 0) return fail("No active agents to assign", 409);

    // Leads already assigned today — the quota is a per-day ceiling.
    const assignedToday = await db
      .select({ agentId: leads.assignedAgentId, value: sql<number>`count(*)::int` })
      .from(leads)
      .where(sql`${leads.assignedAt}::date = current_date and ${leads.assignedAgentId} is not null`)
      .groupBy(leads.assignedAgentId);
    const usedMap = new Map(assignedToday.map((r) => [r.agentId, Number(r.value)]));

    // Remaining capacity per agent.
    const capacity = new Map<string, number>();
    const quotaRows: Array<{ id: string; quota: number | null; remaining: number; used: number }> = [];
    for (const agent of agents) {
      const used = usedMap.get(agent.id) ?? 0;
      // Quota semantics: null -> unlimited (classic round-robin). 0 -> paused.
      const cap = respectQuota
        ? (agent.dailyLeadLimit ?? agent.dailyLeadQuota) === null
          ? Number.POSITIVE_INFINITY
          : Math.max(0, (agent.dailyLeadLimit ?? agent.dailyLeadQuota) as number)
        : Number.POSITIVE_INFINITY;
      const remaining = cap === Number.POSITIVE_INFINITY ? Number.POSITIVE_INFINITY : Math.max(0, cap - used);
      capacity.set(agent.id, remaining);
      quotaRows.push({ id: agent.id, quota: agent.dailyLeadQuota, used, remaining: remaining === Number.POSITIVE_INFINITY ? -1 : remaining });
    }

    const assignable = agents.filter((a) => (capacity.get(a.id) ?? 0) > 0);
    if (assignable.length === 0) {
      return ok({
        assigned: 0,
        agents: agents.length,
        remainingInPool: -1,
        quotaRespected: true,
        message: "Every agent has hit their manual daily lead quota.",
        perAgent: quotaRows,
      });
    }

    // Pull from the pool (niche-scoped when requested).
    const pool = await db
      .select({ id: leads.id, nicheId: leads.nicheId })
      .from(leads)
      .where(
        body.nicheId
          ? and(isNull(leads.assignedAgentId), eq(leads.nicheId, Number(body.nicheId)))
          : isNull(leads.assignedAgentId),
      )
      .orderBy(leads.id)
      .limit(limit);

    // Fair round-robin over agents that still have capacity.
    let cursor = 0;
    let assigned = 0;
    for (const lead of pool) {
      // refresh the set of agents that can still take work
      const eligible = agents.filter((a) => (capacity.get(a.id) ?? 0) > 0);
      if (eligible.length === 0) break;

      // prefer agents whose primary niche matches the lead
      const preferred = eligible.filter((a) => a.primaryNicheId === lead.nicheId);
      const bucket = preferred.length ? preferred : eligible;
      // advance the cursor until it lands on an eligible agent
      let guard = 0;
      while (guard < agents.length) {
        const candidate = bucket[cursor % bucket.length]!;
        if ((capacity.get(candidate.id) ?? 0) > 0) {
          await db
            .update(leads)
            .set({ assignedAgentId: candidate.id, assignedAt: new Date(), status: "NEW", updatedAt: new Date() })
            .where(eq(leads.id, lead.id));
          await recordLeadHistory({
            leadId: lead.id,
            actor: { id: staff.id, role: staff.role, name: staff.name },
            changes: [{ field: "Assigned Agent (auto)", oldValue: null, newValue: candidate.name }],
          });
          capacity.set(candidate.id, (capacity.get(candidate.id) ?? 0) - 1);
          assigned += 1;
          cursor += 1;
          break;
        }
        cursor += 1;
        guard += 1;
      }
    }

    await audit({
      actorId: staff.id,
      actorRole: staff.role,
      action: "AUTO_ASSIGN_ROUND_ROBIN",
      detail: `${assigned} leads across ${agents.length} agents${respectQuota ? " (quotas respected)" : ""}`,
      meta: { perAgent: quotaRows },
    });

    const [{ remaining }] = await db
      .select({ remaining: sql<number>`count(*)::int` })
      .from(leads)
      .where(isNull(leads.assignedAgentId));

    // report per-agent consumption after the run
    const perAgent = quotaRows.map((q) => {
      const left = capacity.get(q.id);
      return {
        id: q.id,
        quota: q.quota,
        usedBefore: q.used,
        // -1 means "no quota configured" (unlimited)
        remaining: left === undefined || left === Number.POSITIVE_INFINITY ? -1 : left,
      };
    });

    return ok({
      assigned,
      agents: agents.length,
      remainingInPool: Number(remaining),
      quotaRespected: respectQuota,
      perAgent,
    });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * POST /api/leads/bulk?op=assign|status|pool|export
 * Management-only bulk operations. `pool` clears the agent while PRESERVING the
 * pipeline status (assignment state and status are decoupled).
 */
export async function PUT(request: Request) {
  try {
    const staff = await requireStaff();
    const url = new URL(request.url);
    const op = url.searchParams.get("op") ?? "";
    const body = (await request.json()) as { ids?: number[]; agentId?: string; status?: string; fields?: Record<string, unknown> };
    const ids = (body.ids ?? []).map(Number).filter((n) => Number.isFinite(n) && n > 0).slice(0, 5000);
    if (ids.length === 0) return fail("No leads selected", 422);

    const now = new Date();

    if (op === "assign") {
      const agentId = asUserId(body.agentId);
      if (!agentId) return fail("agentId is required", 422);
      const [agent] = await db.select().from(users).where(and(eq(users.id, agentId), eq(users.role, "AGENT"))).limit(1);
      if (!agent) return fail("Agent not found", 404);

      const before = await db.select({ id: leads.id, status: leads.status, assignedAgentId: leads.assignedAgentId }).from(leads).where(inArray(leads.id, ids));
      await db
        .update(leads)
        .set({ assignedAgentId: agentId, assignedAt: now, archivedForAgent: false, unassignReason: null, updatedAt: now })
        .where(inArray(leads.id, ids));
      await Promise.all(
        before.map((l) =>
          recordLeadHistory({
            leadId: l.id,
            actor: { id: staff.id, role: staff.role, name: staff.name },
            changes: [{ field: "Assigned Agent", oldValue: l.assignedAgentId ?? null, newValue: `${agent.name} (bulk)` }],
          }),
        ),
      );
      await audit({
        actorId: staff.id,
        actorRole: staff.role,
        action: "BULK_ASSIGN",
        detail: `${ids.length} lead(s) → ${agent.name}`,
        meta: { ids },
      });
      return ok({ updated: ids.length, op: "assign" });
    }

    if (op === "status") {
      const status = String(body.status ?? "");
      if (!["NEW", "IN_PROGRESS", "CALLBACK", "NO_RESPONSE", "REJECTED", "PAYMENT_APPROVAL", "CLOSED", "LOST"].includes(status)) {
        return fail("Invalid status", 422);
      }
      // Moving into a recycling status keeps the agent (management choice);
      // use op=pool to also release ownership.
      const before = await db.select({ id: leads.id, status: leads.status }).from(leads).where(inArray(leads.id, ids));
      await db.update(leads).set({ status, updatedAt: now }).where(inArray(leads.id, ids));
      await Promise.all(
        before
          .filter((l) => l.status !== status)
          .map((l) =>
            recordLeadHistory({
              leadId: l.id,
              actor: { id: staff.id, role: staff.role, name: staff.name },
              changes: [{ field: "Status", oldValue: l.status, newValue: status }],
            }),
          ),
      );
      await audit({
        actorId: staff.id,
        actorRole: staff.role,
        action: "BULK_STATUS",
        detail: `${ids.length} lead(s) → ${status}`,
        meta: { ids, status },
      });
      return ok({ updated: ids.length, op: "status" });
    }

    if (op === "pool") {
      // Remove assignment: clear the owner, PRESERVE the status label.
      const before = await db.select({ id: leads.id, assignedAgentId: leads.assignedAgentId }).from(leads).where(inArray(leads.id, ids));
      await db
        .update(leads)
        .set({
          assignedAgentId: null,
          assignedAt: null,
          accessUnlocked: false,
          unassignReason: "MANUAL",
          updatedAt: now,
        })
        .where(inArray(leads.id, ids));
      await Promise.all(
        before
          .filter((l) => l.assignedAgentId)
          .map((l) =>
            recordLeadHistory({
              leadId: l.id,
              actor: { id: staff.id, role: staff.role, name: staff.name },
              changes: [{ field: "Assigned Agent", oldValue: l.assignedAgentId, newValue: null }],
            }),
          ),
      );
      await audit({
        actorId: staff.id,
        actorRole: staff.role,
        action: "BULK_MOVE_TO_POOL",
        detail: `${ids.length} lead(s) → Pool (status preserved)`,
        meta: { ids },
      });
      return ok({ updated: ids.length, op: "pool" });
    }

    if (op === "fields") {
      // Bulk "Update Lead Fields": whitelisted key/value pairs applied to all ids.
      const TEXT_KEYS = [
        "businessName", "contactName", "phone", "email", "city", "cityKeyword", "address",
        "website", "websiteUrl", "gmapLink", "opensAt", "websiteStatus", "serviceStatus",
        "callStatus", "competitorName", "nicheCategory", "mobileNo", "statusService", "leadStatus", "title",
      ];
      const raw = body.fields ?? {};
      const patch: Record<string, unknown> = { updatedAt: now };
      let accepted = 0;
      for (const [key, value] of Object.entries(raw)) {
        if (!TEXT_KEYS.includes(key) || value === undefined) continue;
        patch[key] = value === null || value === "" ? null : String(value).trim();
        accepted += 1;
      }
      if (accepted === 0) return fail("No valid fields supplied", 422);
      const before = await db.select().from(leads).where(inArray(leads.id, ids));
      await db.update(leads).set(patch).where(inArray(leads.id, ids));
      // cap history writes to the first 500 leads for huge selections
      for (const l of before.slice(0, 500)) {
        const changes = Object.entries(patch)
          .filter(([k]) => k !== "updatedAt")
          .map(([k, v]) => ({ field: k, oldValue: (l as Record<string, unknown>)[k], newValue: v }));
        await recordLeadHistory({ leadId: l.id, actor: { id: staff.id, role: staff.role, name: staff.name }, changes });
      }
      await audit({
        actorId: staff.id,
        actorRole: staff.role,
        action: "BULK_FIELDS",
        detail: `${ids.length} lead(s) — ${Object.keys(patch).filter((k) => k !== "updatedAt").join(", ")}`,
        meta: { ids, patch },
      });
      return ok({ updated: ids.length, op: "fields", fields: accepted });
    }

    if (op === "delete") {
      // HARD restriction: bulk delete is ADMIN-only, even for other staff.
      if (staff.role !== "ADMIN") return fail("Only ADMIN can bulk delete leads", 403);
      const del = await db.delete(leads).where(inArray(leads.id, ids)).returning({ id: leads.id });
      await audit({
        actorId: staff.id,
        actorRole: staff.role,
        action: "BULK_DELETE",
        detail: `${del.length} lead(s) permanently deleted`,
        meta: { ids: del.map((d) => d.id) },
      });
      return ok({ deleted: del.length, op: "delete" });
    }

    if (op === "export") {
      const rows = await db
        .select({
          id: leads.id,
          leadCode: leads.leadCode,
          businessName: leads.businessName,
          contactName: leads.contactName,
          phone: leads.phone,
          city: leads.city,
          status: leads.status,
          rating: leads.rating,
          reviewsCount: leads.reviewsCount,
          niche: niches.name,
          agent: users.name,
          unassignReason: leads.unassignReason,
          dealAmount: leads.dealAmount,
        })
        .from(leads)
        .innerJoin(niches, eq(niches.id, leads.nicheId))
        .leftJoin(users, eq(users.id, leads.assignedAgentId))
        .where(sql`${leads.id} = any(${sql.raw(`array[${ids.join(",")}]`)})`)
        .orderBy(leads.id);

      const header = [
        "lead_id",
        "lead_code",
        "business_name",
        "contact_name",
        "phone",
        "city",
        "pipeline_status",
        "assigned_to",
        "niche",
        "rating",
        "reviews_count",
        "deal_amount",
      ];
      const esc = (v: unknown) => {
        const s = v === null || v === undefined ? "" : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv = [
        header.join(","),
        ...rows.map((r) =>
          [
            r.id,
            r.leadCode,
            r.businessName,
            r.contactName,
            r.phone,
            r.city,
            r.status,
            r.agent ?? "Pool",
            r.niche,
            r.rating,
            r.reviewsCount,
            r.dealAmount,
          ]
            .map(esc)
            .join(","),
        ),
      ].join("\n");

      await audit({
        actorId: staff.id,
        actorRole: staff.role,
        action: "BULK_EXPORT",
        detail: `${rows.length} lead(s) exported`,
        meta: { ids },
      });

      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="leads-export-${Date.now()}.csv"`,
        },
      });
    }

    return fail("Unknown bulk operation", 400);
  } catch (error) {
    return handleError(error);
  }
}
