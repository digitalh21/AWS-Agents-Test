import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { decisionNotices } from "@/db/schema";
import { handleError, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { decisionHistory, pendingDecisionNotices } from "@/lib/decisions";
import { ensureTables } from "@/db/bootstrap";

export const dynamic = "force-dynamic";

/** GET: unread notices (block the screen) plus the full history. */
export async function GET() {
  try {
    await ensureTables();
    const user = await requireUser();
    const [pending, history] = await Promise.all([
      pendingDecisionNotices(user.id),
      decisionHistory(user.id, 30),
    ]);

    return ok({
      pending,
      history,
      // a blocking popup is only needed for APPROVED / REJECTED outcomes
      blocking: pending.some((p) => p.status === "APPROVED" || p.status === "REJECTED"),
    });
  } catch (error) {
    return handleError(error);
  }
}

/** PATCH: acknowledge one notice (or all) — records readAt. */
export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json().catch(() => ({}))) as { id?: number; all?: boolean };

    if (body.all) {
      await db
        .update(decisionNotices)
        .set({ readAt: new Date() })
        .where(and(eq(decisionNotices.userId, user.id), sql`${decisionNotices.readAt} is null`));
      return ok({ ok: true, all: true });
    }

    const id = Number(body.id ?? 0);
    if (!id) return handleError(new Error("id required"));
    await db
      .update(decisionNotices)
      .set({ readAt: new Date() })
      .where(and(eq(decisionNotices.id, id), eq(decisionNotices.userId, user.id)));

    return ok({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
