import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { leads, niches } from "@/db/schema";

export type NicheOption = {
  id: number;
  name: string;
  slug: string;
  color: string;
  description: string | null;
  total: number;
  unassigned: number;
  visibleToAgents?: boolean;
};

/**
 * Niche list + per-niche lead counts.
 * Uses a single GROUP BY over leads (indexed on niche_id) instead of a correlated
 * subquery so it stays fast on 1M+ rows and is always accurate.
 */
export async function nicheOptions(): Promise<NicheOption[]> {
  const [rows, counts, pool] = await Promise.all([
    db
      .select({ id: niches.id, name: niches.name, slug: niches.slug, color: niches.color, description: niches.description })
      .from(niches)
      .orderBy(niches.id),
    db
      .select({ nicheId: leads.nicheId, total: sql<number>`count(*)::int` })
      .from(leads)
      .groupBy(leads.nicheId),
    db
      .select({ nicheId: leads.nicheId, pool: sql<number>`count(*)::int` })
      .from(leads)
      .where(sql`${leads.assignedAgentId} is null`)
      .groupBy(leads.nicheId),
  ]);

  const totalMap = new Map(counts.map((c) => [c.nicheId, Number(c.total)]));
  const poolMap = new Map(pool.map((c) => [c.nicheId, Number(c.pool)]));

  const visibility = await db.select({ id: niches.id, visibleToAgents: niches.visibleToAgents }).from(niches);
  const visMap = new Map(visibility.map((v) => [v.id, v.visibleToAgents]));

  return rows.map((n) => ({
    ...n,
    total: totalMap.get(n.id) ?? 0,
    unassigned: poolMap.get(n.id) ?? 0,
    visibleToAgents: visMap.get(n.id) ?? true,
  }));
}

export async function nicheLeadCount(nicheId: number) {
  const [row] = await db.select({ total: sql<number>`count(*)::int` }).from(leads).where(eq(leads.nicheId, nicheId));
  return Number(row?.total ?? 0);
}

/**
 * Niches a given user may see.
 * Staff always get everything; agents only get niches where visible_to_agents = true.
 * This is the single source of truth for sidebar options AND lead query filtering.
 */
export async function nichesForRole(role: string) {
  const all = await nicheOptions();
  if (role !== "AGENT") return { all, visible: all };
  const visible = all.filter((n) => n.visibleToAgents !== false);
  return { all, visible };
}

/** IDs of niches hidden from Telecalling Agents. */
export async function hiddenNicheIds(): Promise<number[]> {
  const all = await nicheOptions();
  return all.filter((n) => n.visibleToAgents === false).map((n) => n.id);
}
