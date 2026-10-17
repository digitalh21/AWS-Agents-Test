import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { broadcastAcknowledgments, broadcasts, notifications, users } from "@/db/schema";
import { audit, fail, handleError, ok } from "@/lib/api";
import { asUserId, isStaff, requireStaff, requireUser } from "@/lib/auth";
import { ensureTables } from "@/db/bootstrap";

export const dynamic = "force-dynamic";

/** Trim + validate a media URL (http/https only, capped). Returns null when empty/invalid. */
const BROADCAST_TYPES = ["strict_lock", "management_lock", "dismissible_popup", "site_banner"] as const;
type BroadcastType = (typeof BROADCAST_TYPES)[number];

function asBroadcastType(value: unknown): BroadcastType | null {
  return typeof value === "string" && (BROADCAST_TYPES as readonly string[]).includes(value)
    ? (value as BroadcastType)
    : null;
}

function cleanMediaUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;
  if (!/^https?:\/\//i.test(v)) return null;
  return v.slice(0, 2000);
}

/** GET ?mode=manage (staff) -> all broadcasts + ack stats. Default -> my active feed. */
export async function GET(request: Request) {
  try {
    await ensureTables();
    const user = await requireUser();
    const url = new URL(request.url);
    const mode = url.searchParams.get("mode") ?? "feed";

    if (mode === "manage") {
      if (!isStaff(user.role)) return fail("Staff only", 403);
      const rows = await db
        .select({
          id: broadcasts.id,
          title: broadcasts.title,
          body: broadcasts.body,
          imageUrl: broadcasts.imageUrl,
          videoUrl: broadcasts.videoUrl,
          audioUrl: broadcasts.audioUrl,
          kind: broadcasts.kind,
          broadcastType: broadcasts.broadcastType,
          audienceRole: broadcasts.audienceRole,
          targetUserId: broadcasts.targetUserId,
          requireAcknowledgment: broadcasts.requireAcknowledgment,
          isActive: broadcasts.isActive,
          createdAt: broadcasts.createdAt,
          expiresAt: broadcasts.expiresAt,
          createdByName: users.name,
          audienceCount: sql<number>`(select count(*)::int from users u
              where (${broadcasts.targetUserId} is null or u.id = ${broadcasts.targetUserId})
              and (${broadcasts.audienceRole} = 'ALL' or u.role = ${broadcasts.audienceRole}))`,
          ackCount: sql<number>`(select count(*)::int from broadcast_acknowledgments ba where ba.broadcast_id = ${broadcasts.id})`,
        })
        .from(broadcasts)
        .leftJoin(users, eq(users.id, broadcasts.createdBy))
        .orderBy(desc(broadcasts.createdAt))
        .limit(100);

      const ackRows = await db
        .select({
          broadcastId: broadcastAcknowledgments.broadcastId,
          userId: broadcastAcknowledgments.userId,
          userName: users.name,
          userRole: users.role,
          response: broadcastAcknowledgments.response,
          acknowledgedAt: broadcastAcknowledgments.acknowledgedAt,
        })
        .from(broadcastAcknowledgments)
        .innerJoin(users, eq(users.id, broadcastAcknowledgments.userId))
        .orderBy(desc(broadcastAcknowledgments.acknowledgedAt))
        .limit(400);

      return ok({ rows, acknowledgments: ackRows });
    }

    /* ---- agent/staff feed: active broadcasts targeted at me, with ack state ---- */
    const rows = await db
      .select({
        id: broadcasts.id,
        title: broadcasts.title,
        body: broadcasts.body,
        imageUrl: broadcasts.imageUrl,
        videoUrl: broadcasts.videoUrl,
        audioUrl: broadcasts.audioUrl,
        kind: broadcasts.kind,
        broadcastType: broadcasts.broadcastType,
        requireAcknowledgment: broadcasts.requireAcknowledgment,
        createdAt: broadcasts.createdAt,
        createdByName: users.name,
        acknowledgedAt: broadcastAcknowledgments.acknowledgedAt,
        response: broadcastAcknowledgments.response,
      })
      .from(broadcasts)
      .leftJoin(users, eq(users.id, broadcasts.createdBy))
      .leftJoin(
        broadcastAcknowledgments,
        and(eq(broadcastAcknowledgments.broadcastId, broadcasts.id), eq(broadcastAcknowledgments.userId, user.id)),
      )
      .where(
        and(
          eq(broadcasts.isActive, true),
          // only live broadcasts (never-expiring ones always qualify)
          sql`(${broadcasts.expiresAt} is null or ${broadcasts.expiresAt} > now())`,
          sql`(${broadcasts.targetUserId} is null or ${broadcasts.targetUserId} = ${user.id})`,
          sql`(${broadcasts.audienceRole} = 'ALL' or ${broadcasts.audienceRole} = ${user.role})`,
        ),
      )
      .orderBy(desc(broadcasts.createdAt))
      .limit(20);

    // strict_lock + management_lock force engagement (ack / comment) before work resumes
    const pending = rows.filter(
      (r) => (r.broadcastType === "strict_lock" || r.broadcastType === "management_lock") && !r.acknowledgedAt,
    );
    return ok({
      rows,
      lockScreen: pending.length > 0,
      pending,
    });
  } catch (error) {
    return handleError(error);
  }
}

/** POST: create a broadcast (staff). */
export async function POST(request: Request) {
  try {
    const staff = await requireStaff();
    const body = (await request.json()) as {
      title?: string;
      body?: string;
      imageUrl?: string;
      videoUrl?: string;
      audioUrl?: string;
      kind?: string;
      broadcastType?: string;
      audienceRole?: string;
      targetUserId?: number;
      requireAcknowledgment?: boolean;
      expiresInHours?: number;
    };
    const title = (body.title ?? "").trim();
    const text = (body.body ?? "").trim();
    if (title.length < 3) return fail("Title must be at least 3 characters", 422);
    if (text.length < 3) return fail("Message must be at least 3 characters", 422);

    const explicitType = asBroadcastType(body.broadcastType);
    const broadcastType: BroadcastType =
      explicitType ??
      (body.kind === "BANNER" ? "site_banner" : body.requireAcknowledgment === false ? "dismissible_popup" : "strict_lock");
    const kind = broadcastType === "site_banner" ? "BANNER" : "POPUP";
    const requireAck = broadcastType === "strict_lock" || broadcastType === "management_lock";
    const audienceRole = (body.audienceRole ?? "AGENT").toUpperCase();
    if (!["ALL", "AGENT", "MANAGER", "HR", "ADMIN"].includes(audienceRole)) return fail("Invalid audience", 422);
    const targetUserId = asUserId(body.targetUserId);
    if (body.targetUserId && !targetUserId) return fail("Pick a valid agent", 422);

    const [row] = await db
      .insert(broadcasts)
      .values({
        title,
        body: text,
        imageUrl: cleanMediaUrl(body.imageUrl),
        videoUrl: cleanMediaUrl(body.videoUrl),
        audioUrl: cleanMediaUrl(body.audioUrl),
        kind,
        broadcastType,
        audienceRole,
        targetUserId,
        requireAcknowledgment: requireAck,
        createdBy: staff.id,
        expiresAt: body.expiresInHours ? new Date(Date.now() + body.expiresInHours * 3600_000) : null,
      })
      .returning();

    await db.insert(notifications).values({
      title: `📢 ${title}`,
      body: text.slice(0, 200),
      audienceRole,
      targetUserId,
      sentBy: staff.id,
    });

    await audit({
      actorId: staff.id,
      actorRole: staff.role,
      action: "BROADCAST_CREATED",
      detail: `${kind} → ${audienceRole}${targetUserId ? ` (user #${targetUserId})` : ""}: ${title}`,
      meta: { broadcastId: row!.id },
    });

    return ok({ broadcast: row }, 201);
  } catch (error) {
    return handleError(error);
  }
}

/** PATCH: activate/deactivate a broadcast (staff). */
export async function PATCH(request: Request) {
  try {
    const staff = await requireStaff();
    const body = (await request.json()) as {
      id?: number;
      isActive?: boolean;
      title?: string;
      body?: string;
      imageUrl?: string | null;
      videoUrl?: string | null;
      audioUrl?: string | null;
      kind?: string;
      broadcastType?: string;
      requireAcknowledgment?: boolean;
    };
    const id = Number(body.id ?? 0);
    if (!id) return fail("id required", 422);

    const patch: Record<string, unknown> = {};
    if (typeof body.isActive === "boolean") patch.isActive = body.isActive;
    if (typeof body.title === "string" && body.title.trim().length >= 3) patch.title = body.title.trim();
    if (typeof body.body === "string" && body.body.trim().length >= 3) patch.body = body.body.trim();
    if (body.imageUrl !== undefined) patch.imageUrl = cleanMediaUrl(body.imageUrl);
    if (body.videoUrl !== undefined) patch.videoUrl = cleanMediaUrl(body.videoUrl);
    if (body.audioUrl !== undefined) patch.audioUrl = cleanMediaUrl(body.audioUrl);
    if (body.kind === "BANNER" || body.kind === "POPUP") patch.kind = body.kind;
    const nextType = asBroadcastType(body.broadcastType);
    if (nextType) {
      patch.broadcastType = nextType;
      patch.kind = nextType === "site_banner" ? "BANNER" : "POPUP";
      patch.requireAcknowledgment = nextType === "strict_lock" || nextType === "management_lock";
    }
    if (typeof body.requireAcknowledgment === "boolean") patch.requireAcknowledgment = body.requireAcknowledgment;
    if (Object.keys(patch).length === 0) return fail("Nothing to update", 422);

    const [row] = await db
      .update(broadcasts)
      .set(patch)
      .where(eq(broadcasts.id, id))
      .returning();
    if (!row) return fail("Broadcast not found", 404);

    await audit({
      actorId: staff.id,
      actorRole: staff.role,
      action: "BROADCAST_UPDATED",
      detail: `#${id} ${body.isActive !== undefined ? `active=${body.isActive}` : "edited"}`,
    });
    return ok({ broadcast: row });
  } catch (error) {
    return handleError(error);
  }
}

/** PUT: acknowledge a mandatory broadcast (the agent's only way past the lock). */
export async function PUT(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as { id?: number; response?: string };
    const id = Number(body.id ?? 0);
    if (!id) return fail("id required", 422);

    const [broadcast] = await db.select().from(broadcasts).where(eq(broadcasts.id, id)).limit(1);
    if (!broadcast) return fail("Broadcast not found", 404);

    await db
      .insert(broadcastAcknowledgments)
      .values({
        broadcastId: id,
        userId: user.id,
        response: (body.response ?? "ACKNOWLEDGED").toUpperCase().slice(0, 40),
      })
      .onConflictDoNothing();

    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: "BROADCAST_ACKNOWLEDGED",
      detail: `${broadcast.title}`,
      meta: { broadcastId: id },
    });

    return ok({ ok: true, acknowledgedAt: new Date().toISOString() });
  } catch (error) {
    return handleError(error);
  }
}

/** DELETE: remove a broadcast (Admin only). */
export async function DELETE(request: Request) {
  try {
    const staff = await requireStaff();
    if (staff.role !== "ADMIN") return fail("Only ADMIN can delete broadcasts", 403);
    const id = Number(new URL(request.url).searchParams.get("id") ?? 0);
    if (!id) return fail("id required", 422);

    await db.delete(broadcastAcknowledgments).where(eq(broadcastAcknowledgments.broadcastId, id));
    await db.delete(broadcasts).where(eq(broadcasts.id, id));
    await audit({ actorId: staff.id, actorRole: staff.role, action: "BROADCAST_DELETED", detail: `#${id}` });
    return ok({ deleted: true });
  } catch (error) {
    return handleError(error);
  }
}
