import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { notifications, users } from "@/db/schema";
import { audit, fail, handleError, ok } from "@/lib/api";
import { asUserId, requireStaff, requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await db
      .select()
      .from(notifications)
      .where(
        or(
          eq(notifications.targetUserId, user.id),
          and(inArray(notifications.audienceRole, ["ALL", user.role]), isNull(notifications.targetUserId)),
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(40);
    return ok({ rows, unread: rows.filter((r) => !r.readAt).length });
  } catch (error) {
    return handleError(error);
  }
}

/** Broadcast push notification to agents / roles */
export async function POST(request: Request) {
  try {
    const staff = await requireStaff();
    const body = (await request.json()) as { title?: string; message?: string; audienceRole?: string; targetUserId?: string };
    const title = (body.title ?? "").trim();
    const message = (body.message ?? "").trim();
    if (!title || !message) return fail("Title and message are required", 422);
    const audienceRole = (body.audienceRole ?? "ALL").toUpperCase();

    const targetUserId = asUserId(body.targetUserId);
    const [row] = await db
      .insert(notifications)
      .values({
        title,
        body: message,
        audienceRole,
        targetUserId,
        sentBy: staff.id,
      })
      .returning();

    if (targetUserId) {
      await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, targetUserId));
    }

    const [{ value }] = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(notifications)
      .where(eq(notifications.id, row!.id));

    await audit({
      actorId: staff.id,
      actorRole: staff.role,
      action: "PUSH_BROADCAST",
      detail: `${title} → ${audienceRole}`,
    });

    return ok({ notification: row, delivered: Number(value ?? 1) });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH() {
  try {
    const user = await requireUser();
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.targetUserId, user.id), isNull(notifications.readAt)));
    return ok({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
