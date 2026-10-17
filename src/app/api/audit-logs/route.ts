import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs, leads, users } from "@/db/schema";
import { handleError, ok, parseIntOr } from "@/lib/api";
import { asUserId, requireStaff } from "@/lib/auth";
import { ensureSeed } from "@/lib/seed";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await ensureSeed();
    await requireStaff();
    const url = new URL(request.url);
    const page = parseIntOr(url.searchParams.get("page"), 1);
    const pageSize = Math.min(parseIntOr(url.searchParams.get("pageSize"), 50), 200);
    const leadId = parseIntOr(url.searchParams.get("leadId"), 0);
    const actorId = asUserId(url.searchParams.get("actorId"));
    const action = url.searchParams.get("action") ?? "";

    const filters = [];
    if (leadId) filters.push(eq(auditLogs.leadId, leadId));
    if (actorId) filters.push(eq(auditLogs.actorId, actorId));
    if (action && action !== "ALL") filters.push(eq(auditLogs.action, action));

    const where = filters.length ? and(...filters) : undefined;

    const [rows, totalRow, actions, summary] = await Promise.all([
      db
        .select({
          id: auditLogs.id,
          action: auditLogs.action,
          detail: auditLogs.detail,
          meta: auditLogs.meta,
          createdAt: auditLogs.createdAt,
          leadId: auditLogs.leadId,
          businessName: leads.businessName,
          actorId: auditLogs.actorId,
          actorName: users.name,
          actorRole: auditLogs.actorRole,
        })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorId))
        .leftJoin(leads, eq(leads.id, auditLogs.leadId))
        .where(where)
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      db.select({ value: count() }).from(auditLogs).where(where),
      db
        .select({ action: auditLogs.action, value: count() })
        .from(auditLogs)
        .groupBy(auditLogs.action)
        .orderBy(sql`count(*) desc`)
        .limit(25),
      db
        .select({
          today: sql<number>`count(*) filter (where ${auditLogs.createdAt} > now() - interval '24 hours')::int`,
          total: sql<number>`count(*)::int`,
        })
        .from(auditLogs),
    ]);

    return ok({
      rows,
      page,
      pageSize,
      total: Number(totalRow[0]?.value ?? 0),
      totalPages: Math.max(1, Math.ceil(Number(totalRow[0]?.value ?? 0) / pageSize)),
      actions: actions.map((a) => ({ action: a.action, count: Number(a.value) })),
      summary: { today: Number(summary[0]?.today ?? 0), total: Number(summary[0]?.total ?? 0) },
    });
  } catch (error) {
    return handleError(error);
  }
}
