import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { broadcastComments, broadcasts } from "@/db/schema";
import { audit, fail, handleError, ok } from "@/lib/api";
import { isStaff, requireUser } from "@/lib/auth";
import { ensureTables } from "@/db/bootstrap";

export const dynamic = "force-dynamic";

/**
 * Private broadcast comments.
 *
 * VISIBILITY RULE (enforced here, server-side — never trust the client):
 * an agent only ever sees their OWN comments. Management (ADMIN | HR |
 * MANAGER) sees every comment, with the author's name.
 *
 * GET  ?broadcastId=123
 * POST { broadcastId, body }
 */
export async function GET(request: Request) {
  try {
    await ensureTables();
    const user = await requireUser();
    const broadcastId = Number(new URL(request.url).searchParams.get("broadcastId") ?? 0);
    if (!broadcastId) return fail("broadcastId is required", 422);

    const staff = isStaff(user.role);
    const rows = await db
      .select({
        id: broadcastComments.id,
        broadcastId: broadcastComments.broadcastId,
        userId: broadcastComments.userId,
        userName: broadcastComments.userName,
        body: broadcastComments.body,
        createdAt: broadcastComments.createdAt,
      })
      .from(broadcastComments)
      .where(
        staff
          ? eq(broadcastComments.broadcastId, broadcastId)
          : and(eq(broadcastComments.broadcastId, broadcastId), eq(broadcastComments.userId, user.id)),
      )
      .orderBy(desc(broadcastComments.createdAt))
      .limit(staff ? 200 : 50);

    return ok({ rows, staff });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request) {
  try {
    await ensureTables();
    const user = await requireUser();
    const body = (await request.json()) as { broadcastId?: number; body?: string };
    const broadcastId = Number(body.broadcastId ?? 0);
    const text = (body.body ?? "").trim();
    if (!broadcastId) return fail("broadcastId is required", 422);
    if (text.length < 1 || text.length > 2000) return fail("Comment must be 1–2000 characters", 422);

    const [broadcast] = await db
      .select({ id: broadcasts.id, title: broadcasts.title, isActive: broadcasts.isActive })
      .from(broadcasts)
      .where(eq(broadcasts.id, broadcastId))
      .limit(1);
    if (!broadcast) return fail("Broadcast not found", 404);

    const [row] = await db
      .insert(broadcastComments)
      .values({
        broadcastId,
        userId: user.id,
        userName: user.name,
        body: text,
      })
      .returning();

    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: "BROADCAST_COMMENT",
      detail: `Comment on "${broadcast.title}"`,
      meta: { broadcastId, commentId: row!.id },
    });

    return ok({ comment: row }, 201);
  } catch (error) {
    return handleError(error);
  }
}
