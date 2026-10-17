import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { agentSlabs, users } from "@/db/schema";
import { audit, fail, handleError, ok } from "@/lib/api";
import { asUserId, isStaff, requireStaff, requireUser } from "@/lib/auth";
import { approvedCloseCount, getAgentTiers, saveAgentTiers, tierLadder } from "@/lib/commission";
import { ensureTables } from "@/db/bootstrap";

export const dynamic = "force-dynamic";

/**
 * GET /api/agent/slabs                 -> my 5-tier rate card
 * GET /api/agent/slabs?userId=5        -> staff viewing an agent's rate card
 * GET /api/agent/slabs?all=1           -> staff: every agent's rate card + quota
 */
export async function GET(request: Request) {
  try {
    await ensureTables();
    const viewer = await requireUser();
    const url = new URL(request.url);
    const all = url.searchParams.get("all") === "1";

    if (all) {
      if (!isStaff(viewer.role)) return fail("Staff only", 403);
      const agents = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          isActive: users.isActive,
          nicheName: sql<string | null>`(select n.name from niches n where n.id = ${users.primaryNicheId})`,
          closes: sql<number>`(select count(*)::int from deal_approvals da where da.agent_id = ${users.id} and da.status = 'APPROVED')`,
          // effective per-day limit: daily_lead_limit wins, legacy quota fallback
          dailyLeadQuota: sql<number | null>`coalesce(${users.dailyLeadLimit}, ${users.dailyLeadQuota})`,
        })
        .from(users)
        .where(eq(users.role, "AGENT"))
        .orderBy(users.name);

      const withTiers = await Promise.all(
        agents.map(async (a) => ({
          ...a,
          tiers: await getAgentTiers(a.id),
          activeAmount: Number((await getAgentTiers(a.id)).find((t) => a.closes >= t.minCloses && (t.maxCloses === null || a.closes <= t.maxCloses))?.amountPerClose ?? 0),
        })),
      );

      return ok({ ladder: tierLadder(), agents: withTiers, viewer: { role: viewer.role, canEdit: true } });
    }

    const targetId = asUserId(url.searchParams.get("userId")) ?? viewer.id;
    if (targetId !== viewer.id && !isStaff(viewer.role)) return fail("Not permitted", 403);

    const [tiers, closes, quota] = await Promise.all([
      getAgentTiers(targetId),
      approvedCloseCount(targetId),
      db.select({ quota: users.dailyLeadQuota }).from(users).where(eq(users.id, targetId)).limit(1),
    ]);
    const active = tiers.find((t) => closes >= t.minCloses && (t.maxCloses === null || closes <= t.maxCloses)) ?? null;

    return ok({
      userId: targetId,
      tiers,
      ladder: tierLadder(),
      closes,
      activeTier: active ? { tierIndex: active.tierIndex, label: active.label, amountPerClose: active.amountPerClose, custom: active.custom } : null,
      dailyLeadQuota: quota[0]?.quota ?? null,
    });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * PUT /api/agent/slabs
 * Body: { userId, tiers: [{tierIndex, amountPerClose}], reset?: boolean, dailyLeadQuota?: number|null }
 */
export async function PUT(request: Request) {
  try {
    const staff = await requireStaff();
    const body = (await request.json()) as {
      userId?: string;
      tiers?: Array<{ tierIndex: number; amountPerClose: number | string }>;
      reset?: boolean;
      dailyLeadQuota?: number | null;
    };
    const userId = asUserId(body.userId);
    if (!userId) return fail("userId is required", 422);

    const [agent] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!agent) return fail("Agent not found", 404);

    let savedTiers = 0;

    if (body.reset) {
      await db.delete(agentSlabs).where(eq(agentSlabs.userId, userId));
      await audit({
        actorId: staff.id,
        actorRole: staff.role,
        action: "AGENT_SLABS_RESET",
        detail: `${agent.name} reset to global tier rates`,
      });
    } else if (body.tiers?.length) {
      await saveAgentTiers(userId, body.tiers, staff.id);
      savedTiers = body.tiers.length;
      await audit({
        actorId: staff.id,
        actorRole: staff.role,
        action: "AGENT_SLABS_UPDATED",
        detail: `${agent.name}: ${body.tiers.map((t) => `T${t.tierIndex}=₹${t.amountPerClose}`).join(", ")}`,
        meta: { userId, tiers: body.tiers },
      });
    }

    let quota: number | null | undefined;
    if (body.dailyLeadQuota !== undefined) {
      const rawLimit =
        body.dailyLeadQuota === null || body.dailyLeadQuota === undefined
          ? null
          : Math.max(0, Math.min(5000, Math.floor(Number(body.dailyLeadQuota))));
      quota = rawLimit;
      // Per Day Lead Limit accepts 0 = PAUSED; legacy dailyLeadQuota keeps its
      // old "0 or null means global default" semantics.
      await db
        .update(users)
        .set({ dailyLeadQuota: rawLimit === 0 ? null : rawLimit, dailyLeadLimit: rawLimit })
        .where(eq(users.id, userId));
      await audit({
        actorId: staff.id,
        actorRole: staff.role,
        action: "AGENT_QUOTA_UPDATED",
        detail: `${agent.name}: ${quota === null ? "global default" : `${quota} leads/day`}`,
      });
    }

    const tiers = await getAgentTiers(userId);
    const closes = await approvedCloseCount(userId);
    const active = tiers.find((t) => closes >= t.minCloses && (t.maxCloses === null || closes <= t.maxCloses)) ?? null;

    return ok({
      savedTiers,
      reset: Boolean(body.reset),
      userId,
      tiers,
      activeTier: active ? { tierIndex: active.tierIndex, label: active.label, amountPerClose: active.amountPerClose, custom: active.custom } : null,
      dailyLeadQuota: quota === undefined ? (agent.dailyLeadQuota ?? null) : quota,
    });
  } catch (error) {
    return handleError(error);
  }
}
