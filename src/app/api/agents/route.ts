import { desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { callLogs, leads, niches, users } from "@/db/schema";
import { audit, fail, handleError, ok } from "@/lib/api";
import { asUserId, requireStaff } from "@/lib/auth";
import { ensureSeed } from "@/lib/seed";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSeed();
    await requireStaff();
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        phone: users.phone,
        role: users.role,
        isActive: users.isActive,
        isOnline: users.isOnline,
        lastSeenAt: users.lastSeenAt,
        activeSeconds: users.activeSeconds,
        nicheName: niches.name,
        nicheId: users.primaryNicheId,
        kycStatus: users.kycStatus,
        kycAadhaarUrl: users.kycAadhaarUrl,
        kycMarksheetUrl: users.kycMarksheetUrl,
        kycPhotoUrl: users.kycPhotoUrl,
        kycPanUrl: users.kycPanUrl,
        walletTotal: users.walletTotal,
        walletPending: users.walletPending,
        walletApproved: users.walletApproved,
        commissionPerDeal: users.commissionPerDeal,
        dailyClickQuota: users.dailyClickQuota,
        upiId: users.upiId,
        bankName: users.bankName,
        bankAccount: users.bankAccount,
        bankIfsc: users.bankIfsc,
        leadCount: sql<number>`(select count(*) from ${leads} where ${leads.assignedAgentId} = ${users.id})::int`,
        closedCount: sql<number>`(select count(*) from ${leads} where ${leads.assignedAgentId} = ${users.id} and ${leads.status} = 'CLOSED')::int`,
        calls: sql<number>`(select count(*) from ${callLogs} where ${callLogs.agentId} = ${users.id} and ${callLogs.status} <> 'DIALING')::int`,
        talkSeconds: sql<number>`(select coalesce(sum(${callLogs.durationSeconds}),0) from ${callLogs} where ${callLogs.agentId} = ${users.id})::int`,
      })
      .from(users)
      .leftJoin(niches, eq(niches.id, users.primaryNicheId))
      .orderBy(users.role, users.name);

    const nicheRows = await db.select().from(niches).orderBy(niches.id);
    return ok({ rows, niches: nicheRows });
  } catch (error) {
    return handleError(error);
  }
}

/** HR/Admin agent management: KYC, wallet adjust, activate, role change */
export async function PATCH(request: Request) {
  try {
    const staff = await requireStaff();
    const body = (await request.json()) as Record<string, unknown>;
    const userId = asUserId(body.userId);
    if (!userId) return fail("userId is required", 422);

    const patch: Record<string, unknown> = {};
    if (typeof body.kycStatus === "string") patch.kycStatus = body.kycStatus.toUpperCase();
    if (typeof body.isActive === "boolean") patch.isActive = body.isActive;
    if (typeof body.isOnline === "boolean") patch.isOnline = body.isOnline;
    if (body.primaryNicheId !== undefined) patch.primaryNicheId = body.primaryNicheId ? Number(body.primaryNicheId) : null;
    if (body.commissionPerDeal !== undefined) patch.commissionPerDeal = String(body.commissionPerDeal);
    // Daily Click Quota allocation (null = unlimited, 0 = locked out)
    if (body.dailyClickQuota !== undefined) {
      patch.dailyClickQuota =
        body.dailyClickQuota === null || body.dailyClickQuota === ""
          ? null
          : Math.max(0, Math.min(100000, Math.floor(Number(body.dailyClickQuota))));
    }
    if (body.walletAdjust !== undefined && Number(body.walletAdjust) !== 0) {
      patch.walletPending = sql`greatest(${users.walletPending} + ${Number(body.walletAdjust)}, 0)`;
      patch.walletTotal = sql`greatest(${users.walletTotal} + ${Number(body.walletAdjust)}, 0)`;
    }
    if (Object.keys(patch).length === 0) return fail("Nothing to update", 422);

    const [updated] = await db.update(users).set(patch).where(eq(users.id, userId)).returning({ id: users.id, name: users.name });
    if (!updated) return fail("User not found", 404);

    await audit({
      actorId: staff.id,
      actorRole: staff.role,
      action: "USER_UPDATED",
      detail: `${updated.name}: ${Object.keys(patch).join(", ")}`,
      meta: { userId },
    });
    return ok({ updated });
  }
  catch (error) {
    return handleError(error);
  }
}

/** Create a new agent / staff login (HR + Admin) */
export async function POST(request: Request) {
  try {
    const staff = await requireStaff();
    const body = (await request.json()) as Record<string, unknown>;
    const email = String(body.email ?? "").trim().toLowerCase();
    const name = String(body.name ?? "").trim();
    const role = String(body.role ?? "AGENT").toUpperCase();
    if (!email || !name) return fail("Name and email required", 422);
    if (!["AGENT", "MANAGER", "HR", "ADMIN"].includes(role)) return fail("Invalid role", 422);

    const existing = await db.select({ id: users.id }).from(users).where(inArray(users.email, [email])).limit(1);
    if (existing.length) return fail("Email already registered", 409);

    const { hashPassword } = await import("@/lib/auth");
    const [created] = await db
      .insert(users)
      .values({
        name,
        email,
        phone: body.phone ? String(body.phone) : null,
        role,
        passwordHash: hashPassword(String(body.password ?? "password123")),
        primaryNicheId: body.primaryNicheId ? Number(body.primaryNicheId) : null,
        commissionPerDeal: String(body.commissionPerDeal ?? 500),
      })
      .returning({ id: users.id, name: users.name, role: users.role });

    await audit({ actorId: staff.id, actorRole: staff.role, action: "USER_CREATED", detail: `${name} (${role})` });
    return ok({ created }, 201);
  } catch (error) {
    return handleError(error);
  }
}


