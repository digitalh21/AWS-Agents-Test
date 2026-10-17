import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { agentSlabs, commissionSlabs, dealApprovals, users } from "@/db/schema";

export type Slab = {
  id: number;
  label: string;
  minCloses: number;
  maxCloses: number | null;
  amountPerClose: string;
};

/** Default tiered structure per the spec: 0-15, 16-30, 31-50, 50+. */
/** The five mandated tiers. Bounds are fixed; rates are configurable. */
export const TIERS = [
  { tierIndex: 1, label: "Tier 1", minCloses: 0, maxCloses: 15 },
  { tierIndex: 2, label: "Tier 2", minCloses: 16, maxCloses: 30 },
  { tierIndex: 3, label: "Tier 3", minCloses: 31, maxCloses: 50 },
  { tierIndex: 4, label: "Tier 4", minCloses: 51, maxCloses: 75 },
  { tierIndex: 5, label: "Tier 5", minCloses: 76, maxCloses: null },
] as const;

export const TIER_BOUNDS = [
  { label: "0 – 15 Closes", minCloses: 0, maxCloses: 15 },
  { label: "16 – 30 Closes", minCloses: 16, maxCloses: 30 },
  { label: "31 – 50 Closes", minCloses: 31, maxCloses: 50 },
  { label: "51 – 75 Closes", minCloses: 51, maxCloses: 75 },
  { label: "75+ Closes", minCloses: 76, maxCloses: null },
] as const;

export const DEFAULT_SLABS = [
  { label: "0 – 15 Closes", minCloses: 0, maxCloses: 15, amountPerClose: "300" },
  { label: "16 – 30 Closes", minCloses: 16, maxCloses: 30, amountPerClose: "450" },
  { label: "31 – 50 Closes", minCloses: 31, maxCloses: 50, amountPerClose: "600" },
  { label: "51 – 75 Closes", minCloses: 51, maxCloses: 75, amountPerClose: "750" },
  { label: "75+ Closes", minCloses: 76, maxCloses: null, amountPerClose: "900" },
];

export type TierRate = {
  tierIndex: number;
  label: string;
  minCloses: number;
  maxCloses: number | null;
  amountPerClose: string;
  /** true when this rate came from a per-agent override */
  custom: boolean;
};

export async function ensureSlabs() {
  const rows = await db.select({ id: commissionSlabs.id }).from(commissionSlabs).limit(1);
  if (rows.length > 0) return;
  const adminRes = await db.execute<{ id: string }>(sql`select id from users where role = 'ADMIN' order by id limit 1`);
  const adminId = adminRes.rows[0]?.id ?? null;
  for (let i = 0; i < DEFAULT_SLABS.length; i += 1) {
    await db.insert(commissionSlabs).values({
      ...DEFAULT_SLABS[i]!,
      tierIndex: i + 1,
      updatedBy: adminId,
    });
  }
}

export async function getSlabs(): Promise<Slab[]> {
  await ensureSlabs();
  return db
    .select({
      id: commissionSlabs.id,
      label: commissionSlabs.label,
      minCloses: commissionSlabs.minCloses,
      maxCloses: commissionSlabs.maxCloses,
      amountPerClose: commissionSlabs.amountPerClose,
    })
    .from(commissionSlabs)
    .where(eq(commissionSlabs.isActive, true))
    .orderBy(asc(commissionSlabs.minCloses));
}

/** Number of APPROVED deals an agent has closed. */
export async function approvedCloseCount(agentId: string) {
  const [row] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(dealApprovals)
    .where(and(eq(dealApprovals.agentId, agentId), eq(dealApprovals.status, "APPROVED")));
  return Number(row?.value ?? 0);
}

/** The slab that applies to a close count. */
export function slabForCount(
  slabs: Array<{ label: string; minCloses: number; maxCloses: number | null; amountPerClose: string; custom?: boolean }>,
  closes: number,
): { label: string; minCloses: number; maxCloses: number | null; amountPerClose: string; custom: boolean } | null {
  for (const slab of slabs) {
    const max = slab.maxCloses === null ? Number.POSITIVE_INFINITY : slab.maxCloses;
    if (closes >= slab.minCloses && closes <= max) return { ...slab, custom: Boolean(slab.custom) };
  }
  const last = slabs[slabs.length - 1];
  return last ? { ...last, custom: Boolean(last.custom) } : null;
}

/** Canonical five tiers used by every UI control. */
export function tierLadder(): TierRate[] {
  return TIERS.map((t, i) => ({
    tierIndex: t.tierIndex,
    label: `${TIER_BOUNDS[i]!.label}`,
    minCloses: t.minCloses,
    maxCloses: t.maxCloses,
    amountPerClose: String(DEFAULT_SLABS[i]!.amountPerClose),
    custom: false,
  }));
}

/**
 * Effective five-tier rate card for one agent.
 * Per-agent overrides (agent_slabs) win; missing tiers fall back to the global slab.
 */
export async function getAgentTiers(agentId: string): Promise<TierRate[]> {
  const [globalRows, overrides] = await Promise.all([
    getSlabs(),
    db
      .select({
        tierIndex: agentSlabs.tierIndex,
        label: agentSlabs.label,
        minCloses: agentSlabs.minCloses,
        maxCloses: agentSlabs.maxCloses,
        amountPerClose: agentSlabs.amountPerClose,
      })
      .from(agentSlabs)
      .where(eq(agentSlabs.userId, agentId))
      .orderBy(asc(agentSlabs.tierIndex)),
  ]);

  const overrideMap = new Map(overrides.map((o) => [o.tierIndex, o]));

  return TIERS.map((tier, i) => {
    const o = overrideMap.get(tier.tierIndex);
    if (o) {
      return {
        tierIndex: tier.tierIndex,
        label: o.label,
        minCloses: o.minCloses,
        maxCloses: o.maxCloses,
        amountPerClose: o.amountPerClose,
        custom: true,
      };
    }
    const g = globalRows[i];
    return {
      tierIndex: tier.tierIndex,
      label: TIER_BOUNDS[i]!.label,
      minCloses: tier.minCloses,
      maxCloses: tier.maxCloses,
      amountPerClose: g?.amountPerClose ?? String(DEFAULT_SLABS[i]!.amountPerClose),
      custom: false,
    };
  });
}

/** Resolves the commission an agent earns for the *next* close (override-aware). */
export async function resolveAgentCommission(agentId: string) {
  const [tiers, closes] = await Promise.all([getAgentTiers(agentId), approvedCloseCount(agentId)]);
  const slab = slabForCount(tiers, closes);
  const nextTier = tiers.find((t) => t.minCloses > closes) ?? null;
  return {
    closes,
    tiers,
    slab,
    amount: Number(slab?.amountPerClose ?? 0),
    nextSlab: nextTier ? { label: nextTier.label, minCloses: nextTier.minCloses } : null,
    custom: Boolean(slab?.custom),
  };
}

/** Saves a full per-agent rate card (5 tiers). */
export async function saveAgentTiers(
  agentId: string,
  rates: Array<{ tierIndex: number; amountPerClose: number | string }>,
  updatedBy: string,
) {
  for (const rate of rates) {
    const tier = TIERS.find((t) => t.tierIndex === Number(rate.tierIndex));
    if (!tier) continue;
    const amount = Number(rate.amountPerClose);
    if (!Number.isFinite(amount) || amount < 0) continue;
    const bounds = TIER_BOUNDS[tier.tierIndex - 1]!;
    await db
      .insert(agentSlabs)
      .values({
        userId: agentId,
        tierIndex: tier.tierIndex,
        label: bounds.label,
        minCloses: bounds.minCloses,
        maxCloses: bounds.maxCloses,
        amountPerClose: String(amount),
        updatedBy,
      })
      .onConflictDoUpdate({
        target: [agentSlabs.userId, agentSlabs.tierIndex],
        set: { amountPerClose: String(amount), updatedBy, updatedAt: new Date() },
      });
  }
}

/** Manual daily quota for an agent (null = use the global default). */
export async function getDailyQuota(agentId: string) {
  const [row] = await db
    .select({ limit: users.dailyLeadLimit, quota: users.dailyLeadQuota })
    .from(users)
    .where(eq(users.id, agentId))
    .limit(1);
  // daily_lead_limit (Per Day Lead Limit) wins; legacy quota kept as fallback.
  return row?.limit ?? row?.quota ?? null;
}

/** Back-compat alias — now override-aware. */
export async function resolveCommission(agentId: string) {
  const resolved = await resolveAgentCommission(agentId);
  return { ...resolved, slabs: resolved.tiers };
}
