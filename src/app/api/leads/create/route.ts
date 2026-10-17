import { eq } from "drizzle-orm";
import { db } from "@/db";
import { leads, niches } from "@/db/schema";
import { audit, fail, handleError, ok } from "@/lib/api";
import { asUserId, requireStaff, requireUser } from "@/lib/auth";
import { ensureTables } from "@/db/bootstrap";

export const dynamic = "force-dynamic";

/** POST /api/leads/create — staff create a real lead. */
export async function POST(request: Request) {
  try {
    await ensureTables();
    const staff = await requireStaff();
    const body = (await request.json()) as Record<string, unknown>;

    const businessName = String(body.businessName ?? "").trim();
    const phone = String(body.phone ?? "").replace(/[^0-9]/g, "");
    if (businessName.length < 2) return fail("Business name is required", 422);
    if (phone.length < 10) return fail("A valid 10-digit phone number is required", 422);

    // niche: explicit id, else the staff member's primary niche, else the first niche.
    // When none exists the lead is still created with niche_id NULL (never an error).
    let nicheId = Number(body.nicheId ?? 0) || staff.primaryNicheId || 0;
    if (!nicheId) {
      const [first] = await db.select({ id: niches.id }).from(niches).limit(1);
      nicheId = first?.id ?? 0;
    }
    const finalNicheId = nicheId > 0 ? nicheId : null;

    // agent assignment is optional: an unknown/malformed id degrades to "in the pool"
    const assignedAgentId = asUserId(body.assignedAgentId);

    const phoneNormalized = `91${phone.slice(-10)}`;
    const providedCode = String(body.leadCode ?? "").trim();
    // never null: fall back to a unique provisional code, refined to the
    // canonical serial (LEAD-000123) right after insert using the row id.
    const leadCode = providedCode || `LEAD-TEMP-${Date.now().toString(36).toUpperCase()}`;

    const [row] = await db
      .insert(leads)
      .values({
        leadCode,
        nicheId: finalNicheId,
        businessName,
        contactName: String(body.contactName ?? "").trim() || null,
        phone,
        phoneNormalized,
        gmapLink: String(body.gmapLink ?? "").trim() || null,
        cityKeyword: String(body.city ?? "").trim() || null,
        city: String(body.city ?? "").trim() || null,
        address: String(body.address ?? "").trim() || null,
        email: String(body.email ?? "").trim() || null,
        websiteUrl: String(body.websiteUrl ?? "").trim() || null,
        website: String(body.websiteUrl ?? "").trim() || null,
        opensAt: String(body.opensAt ?? "").trim() || null,
        websiteStatus: String(body.websiteStatus ?? "").trim() || null,
        serviceStatus: String(body.serviceStatus ?? "").trim() || null,
        callStatus: String(body.callStatus ?? "").trim() || "Not Dialed",
        rating: body.rating !== undefined && body.rating !== "" ? String(body.rating) : "0",
        reviewsCount: Number(body.reviewsCount ?? 0) || 0,
        // extended lead structure
        title: String(body.title ?? "").trim() || null,
        reviews: Number(body.reviews ?? 0) || 0,
        nicheCategory: String(body.nicheCategory ?? "").trim() || null,
        mobileNo: String(body.mobileNo ?? "").trim() || null,
        statusService: String(body.statusService ?? "").trim() || null,
        leadStatus: String(body.leadStatus ?? "").trim() || null,
        leadCloseAmount:
          body.leadCloseAmount !== undefined && body.leadCloseAmount !== null && body.leadCloseAmount !== ""
            ? String(Number(body.leadCloseAmount) || 0)
            : null,
        competitorName: String(body.competitorName ?? "").trim() || null,
        competitorReviews: Number(body.competitorReviews ?? 0) || 0,
        // new leads start in the Pool — assignment is a separate decision
        status: "NEW",
        assignedAgentId,
        assignedAt: assignedAgentId ? new Date() : null,
        batchId: "MANUAL",
      })
      .returning();

    // Stamp the canonical unique serial (LEAD-000001 style) when the code was
    // auto-generated — the row id guarantees uniqueness, so lead_code is never
    // null/empty for new leads.
    let finalLeadCode = row!.leadCode;
    if (!providedCode && row!.id != null) {
      finalLeadCode = `LEAD-${String(row!.id).padStart(6, "0")}`;
      await db.update(leads).set({ leadCode: finalLeadCode, updatedAt: new Date() }).where(eq(leads.id, row!.id));
    }

    await audit({
      actorId: staff.id,
      actorRole: staff.role,
      leadId: row!.id,
      action: "LEAD_CREATED",
      detail: `${businessName} (${phone})`,
      meta: { nicheId },
    });

    return ok({ lead: { ...row, leadCode: finalLeadCode } }, 201);
  } catch (error) {
    return handleError(error);
  }
}

/** GET /api/leads/create?nicheId=… — helper for the create form (niche list). */
export async function GET() {
  try {
    await ensureTables();
    await requireUser();
    const rows = await db.select({ id: niches.id, name: niches.name }).from(niches);
    return ok({ niches: rows });
  } catch (error) {
    return handleError(error);
  }
}
