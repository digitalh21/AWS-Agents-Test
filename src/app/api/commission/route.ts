import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bonuses, commissionSlabs, dealApprovals, notifications, users } from "@/db/schema";
import { audit, fail, handleError, ok } from "@/lib/api";
import { asUserId, requireStaff } from "@/lib/auth";
import { getSlabs } from "@/lib/commission";
import { ensureTables } from "@/db/bootstrap";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureTables();
    const staff = await requireStaff();
    const slabs = await getSlabs();

    // Per-agent tier position + earnings so the matrix is actionable.
    const agents = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        closes: sql<number>`(select count(*)::int from deal_approvals da where da.agent_id = ${users.id} and da.status = 'APPROVED')`,
        bonusTotal: sql<number>`(select coalesce(sum(b.amount), 0)::float from bonuses b where b.user_id = ${users.id} and b.status = 'APPROVED')`,
        commissionTotal: sql<number>`(select coalesce(sum(da.commission), 0)::float from deal_approvals da where da.agent_id = ${users.id} and da.status = 'APPROVED')`,
        walletPending: users.walletPending,
        walletApproved: users.walletApproved,
      })
      .from(users)
      .where(eq(users.role, "AGENT"))
      .orderBy(users.name);

    const canEdit = staff.role === "ADMIN" || staff.role === "HR" || staff.role === "MANAGER";

    const dealRows = await db
      .select({
        id: dealApprovals.id,
        agentId: dealApprovals.agentId,
        agentName: users.name,
        leadId: dealApprovals.leadId,
        amount: dealApprovals.amount,
        commission: dealApprovals.commission,
        slabLabel: dealApprovals.slabLabel,
        status: dealApprovals.status,
        decidedAt: dealApprovals.decidedAt,
        createdAt: dealApprovals.createdAt,
      })
      .from(dealApprovals)
      .innerJoin(users, eq(users.id, dealApprovals.agentId))
      .orderBy(sql`${dealApprovals.createdAt} desc`)
      .limit(80);

    const bonusRows = await db
      .select({
        id: bonuses.id,
        userId: bonuses.userId,
        agentName: users.name,
        amount: bonuses.amount,
        title: bonuses.title,
        note: bonuses.note,
        status: bonuses.status,
        createdAt: bonuses.createdAt,
      })
      .from(bonuses)
      .innerJoin(users, eq(users.id, bonuses.userId))
      .orderBy(sql`${bonuses.createdAt} desc`)
      .limit(60);

    return ok({
      slabs,
      agents,
      deals: dealRows,
      bonuses: bonusRows,
      viewer: { id: staff.id, role: staff.role, canEdit },
    });
  } catch (error) {
    return handleError(error);
  }
}

/** Create / update the tiered commission slabs. */
export async function PUT(request: Request) {
  try {
    const staff = await requireStaff();
    const body = (await request.json()) as {
      slabs?: Array<{ id?: number; label: string; minCloses: number; maxCloses: number | null; amountPerClose: number | string }>;
    };
    if (!body.slabs?.length) return fail("slabs array required", 422);

    let saved = 0;
    for (const slab of body.slabs) {
      const min = Math.max(0, Math.floor(Number(slab.minCloses)));
      const max = slab.maxCloses === null || slab.maxCloses === undefined ? null : Math.floor(Number(slab.maxCloses));
      if (max !== null && max < min) return fail(`Slab "${slab.label}" has max < min`, 422);
      const amount = Number(slab.amountPerClose);
      if (!Number.isFinite(amount) || amount < 0) return fail(`Slab "${slab.label}" needs a valid amount`, 422);

      if (slab.id) {
        await db
          .update(commissionSlabs)
          .set({
            label: slab.label,
            minCloses: min,
            maxCloses: max,
            amountPerClose: String(amount),
            updatedBy: staff.id,
            updatedAt: new Date(),
          })
          .where(eq(commissionSlabs.id, Number(slab.id)));
      } else {
        await db.insert(commissionSlabs).values({
          label: slab.label,
          minCloses: min,
          maxCloses: max,
          amountPerClose: String(amount),
          updatedBy: staff.id,
        });
      }
      saved += 1;
    }

    await audit({
      actorId: staff.id,
      actorRole: staff.role,
      action: "COMMISSION_SLABS_UPDATED",
      detail: `${saved} slab(s) saved`,
      meta: { slabs: body.slabs },
    });

    return ok({ saved, slabs: await getSlabs() });
  } catch (error) {
    return handleError(error);
  }
}

/** Grant a custom bonus to an agent. */
export async function POST(request: Request) {
  try {
    const staff = await requireStaff();
    const body = (await request.json()) as { userId?: string; amount?: number; title?: string; note?: string };
    const userId = asUserId(body.userId);
    const amount = Number(body.amount ?? 0);
    if (!userId) return fail("userId required", 422);
    if (!Number.isFinite(amount) || amount <= 0) return fail("Enter a valid bonus amount", 422);

    const [agent] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!agent) return fail("Agent not found", 404);

    const [row] = await db
      .insert(bonuses)
      .values({
        userId,
        amount: String(amount),
        title: (body.title ?? "Performance Bonus").trim(),
        note: body.note ?? null,
        createdBy: staff.id,
        status: "APPROVED",
      })
      .returning();

    // Bonuses credit the wallet immediately (separate from lead commission).
    await db
      .update(users)
      .set({
        walletPending: sql`${users.walletPending} + ${amount}`,
        walletTotal: sql`${users.walletTotal} + ${amount}`,
      })
      .where(eq(users.id, userId));

    await db.insert(notifications).values({
      title: "Bonus credited 🎉",
      body: `${staff.name} credited a ₹${amount} bonus — ${body.title ?? "Performance Bonus"}.`,
      audienceRole: "ALL",
      targetUserId: userId,
      sentBy: staff.id,
    });

    await audit({
      actorId: staff.id,
      actorRole: staff.role,
      action: "BONUS_GRANTED",
      detail: `₹${amount} to ${agent.name}`,
      meta: { bonusId: row!.id },
    });

    return ok({ bonus: row }, 201);
  } catch (error) {
    return handleError(error);
  }
}
