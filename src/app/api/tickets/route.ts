import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { notifications, ticketMessages, tickets, users } from "@/db/schema";
import { audit, fail, handleError, ok } from "@/lib/api";
import { isStaff, requireStaff, requireUser } from "@/lib/auth";
import { emitDecisionNotice } from "@/lib/decisions";
import { ensureSeed } from "@/lib/seed";

export const dynamic = "force-dynamic";

export const TICKET_CATEGORIES = [
  { value: "ACCESS_ISSUE", label: "Access Issue" },
  { value: "DATA_CORRECTION", label: "Data Correction" },
  { value: "PAYOUT_QUERY", label: "Payout Query" },
  { value: "LEAD_ISSUE", label: "Lead Issue" },
  { value: "TECHNICAL", label: "Technical Problem" },
  { value: "OTHER", label: "Other Request" },
] as const;

export const TICKET_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_AGENT", "RESOLVED", "REJECTED"] as const;

/** Random but collision-checked ticket number, e.g. TKT-84920. */
async function nextTicketNumber() {
  for (let i = 0; i < 8; i += 1) {
    const candidate = `TKT-${Math.floor(10000 + Math.random() * 89999)}`;
    const hit = await db.select({ id: tickets.id }).from(tickets).where(eq(tickets.ticketNumber, candidate)).limit(1);
    if (hit.length === 0) return candidate;
  }
  return `TKT-${Date.now().toString().slice(-6)}`;
}

/**
 * GET /api/tickets                -> list (agent: own, staff: all) with unread reply counts
 * GET /api/tickets?id=1           -> ticket + its private message thread
 */
export async function GET(request: Request) {
  try {
    await ensureSeed();
    const user = await requireUser();
    const url = new URL(request.url);
    const id = Number(url.searchParams.get("id") ?? 0);
    const scope = url.searchParams.get("scope") ?? "ALL";

    if (id) {
      const [ticket] = await db
        .select({
          id: tickets.id,
          ticketNumber: tickets.ticketNumber,
          userId: tickets.userId,
          leadId: tickets.leadId,
          category: tickets.category,
          subject: tickets.subject,
          details: tickets.details,
          proofUrl: tickets.proofUrl,
          status: tickets.status,
          priority: tickets.priority,
          resolution: tickets.resolution,
          createdAt: tickets.createdAt,
          updatedAt: tickets.updatedAt,
          resolvedAt: tickets.resolvedAt,
          agentName: users.name,
          agentRole: users.role,
          agentEmail: users.email,
        })
        .from(tickets)
        .innerJoin(users, eq(users.id, tickets.userId))
        .where(eq(tickets.id, id))
        .limit(1);

      if (!ticket) return fail("Ticket not found", 404);
      // Tickets are strictly private: the owner or staff only.
      if (ticket.userId !== user.id && !isStaff(user.role)) return fail("Not permitted", 403);

      const messages = await db
        .select({
          id: ticketMessages.id,
          fromUserId: ticketMessages.fromUserId,
          body: ticketMessages.body,
          attachmentUrl: ticketMessages.attachmentUrl,
          createdAt: ticketMessages.createdAt,
          senderName: users.name,
          senderRole: users.role,
        })
        .from(ticketMessages)
        .innerJoin(users, eq(users.id, ticketMessages.fromUserId))
        .where(eq(ticketMessages.ticketId, id))
        .orderBy(ticketMessages.createdAt)
        .limit(200);

      // mark staff replies as read for the agent (and vice versa)
      const otherIds = messages.filter((m) => m.fromUserId !== user.id).map((m) => m.id);
      if (otherIds.length) {
        await db
          .update(ticketMessages)
          .set({ readAt: new Date() })
          .where(sql`${ticketMessages.id} = any(${sql.raw(`array[${otherIds.join(",")}]`)}) and ${ticketMessages.readAt} is null`);
      }

      return ok({ ticket, messages });
    }

    const rows = await db
      .select({
        id: tickets.id,
        ticketNumber: tickets.ticketNumber,
        userId: tickets.userId,
        leadId: tickets.leadId,
        category: tickets.category,
        subject: tickets.subject,
        details: tickets.details,
        proofUrl: tickets.proofUrl,
        status: tickets.status,
        priority: tickets.priority,
        resolution: tickets.resolution,
        createdAt: tickets.createdAt,
        updatedAt: tickets.updatedAt,
        agentName: users.name,
        agentEmail: users.email,
        agentRole: users.role,
        messages: sql<number>`(select count(*)::int from ticket_messages tm where tm.ticket_id = ${tickets.id})`,
        unread: sql<number>`(select count(*)::int from ticket_messages tm where tm.ticket_id = ${tickets.id} and tm.from_user_id <> ${user.id} and tm.read_at is null)`,
      })
      .from(tickets)
      .innerJoin(users, eq(users.id, tickets.userId))
      .where(and(isStaff(user.role) ? undefined : eq(tickets.userId, user.id), scope === "ALL" ? undefined : eq(tickets.status, scope)))
      .orderBy(desc(tickets.updatedAt))
      .limit(120);

    const [counts] = await db
      .select({
        open: sql<number>`count(*) filter (where ${tickets.status} = 'OPEN')::int`,
        inProgress: sql<number>`count(*) filter (where ${tickets.status} = 'IN_PROGRESS')::int`,
        waiting: sql<number>`count(*) filter (where ${tickets.status} = 'WAITING_AGENT')::int`,
        resolved: sql<number>`count(*) filter (where ${tickets.status} = 'RESOLVED')::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(tickets)
      .where(isStaff(user.role) ? undefined : eq(tickets.userId, user.id));

    return ok({
      rows,
      counts: {
        open: Number(counts?.open ?? 0),
        inProgress: Number(counts?.inProgress ?? 0),
        waiting: Number(counts?.waiting ?? 0),
        resolved: Number(counts?.resolved ?? 0),
        total: Number(counts?.total ?? 0),
      },
      categories: TICKET_CATEGORIES,
      statuses: TICKET_STATUSES,
      viewer: { id: user.id, role: user.role, isStaff: isStaff(user.role) },
    });
  } catch (error) {
    return handleError(error);
  }
}

/** POST: create a ticket (unique TKT number) with optional proof attachment. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as {
      category?: string;
      subject?: string;
      details?: string;
      proofUrl?: string;
      leadId?: number;
      priority?: string;
    };
    const subject = (body.subject ?? "").trim();
    const details = (body.details ?? "").trim();
    if (subject.length < 4) return fail("Add a short subject (min 4 characters)", 422);
    if (details.length < 10) return fail("Describe the issue in at least 10 characters", 422);

    const ticketNumber = await nextTicketNumber();
    const [row] = await db
      .insert(tickets)
      .values({
        ticketNumber,
        userId: user.id,
        leadId: body.leadId ? Number(body.leadId) : null,
        category: body.category ?? "OTHER",
        subject,
        details,
        proofUrl: body.proofUrl ?? null,
        priority: body.priority ?? "NORMAL",
        status: "OPEN",
      })
      .returning();

    // opening message seeds the private thread
    await db.insert(ticketMessages).values({
      ticketId: row!.id,
      fromUserId: user.id,
      body: details,
      attachmentUrl: body.proofUrl ?? null,
    });

    await db.insert(notifications).values({
      title: `New ticket ${ticketNumber}`,
      body: `${user.name} raised a ${body.category ?? "OTHER"} ticket: ${subject}`,
      audienceRole: "ALL",
      sentBy: user.id,
    });

    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: "TICKET_CREATED",
      detail: `${ticketNumber}: ${subject}`,
      meta: { ticketId: row!.id },
    });

    return ok({ ticket: row }, 201);
  } catch (error) {
    return handleError(error);
  }
}

/** PATCH: staff update status/priority/resolution. */
export async function PATCH(request: Request) {
  try {
    const staff = await requireStaff();
    const body = (await request.json()) as {
      id?: number;
      status?: string;
      priority?: string;
      resolution?: string;
      assignedTo?: number;
    };
    const id = Number(body.id ?? 0);
    if (!id) return fail("id required", 422);

    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
    if (!ticket) return fail("Ticket not found", 404);

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.status && TICKET_STATUSES.includes(body.status as (typeof TICKET_STATUSES)[number])) {
      patch.status = body.status;
      if (body.status === "RESOLVED") {
        patch.resolvedAt = new Date();
        patch.resolution = body.resolution ?? ticket.resolution;
      }
    }
    if (body.priority) patch.priority = body.priority;
    if (body.assignedTo) patch.assignedTo = Number(body.assignedTo);
    if (body.resolution) patch.resolution = body.resolution;

    const [updated] = await db.update(tickets).set(patch).where(eq(tickets.id, id)).returning();

    await db.insert(notifications).values({
      title: `Ticket ${ticket.ticketNumber} → ${updated!.status}`,
      body: body.resolution ?? `Status updated by ${staff.name}.`,
      audienceRole: "ALL",
      targetUserId: ticket.userId,
      sentBy: staff.id,
    });

    await audit({
      actorId: staff.id,
      actorRole: staff.role,
      action: "TICKET_UPDATED",
      detail: `${ticket.ticketNumber} → ${updated!.status}`,
      meta: { ticketId: id },
    });

    // AUTOMATED AGENT POPUP — ticket outcome
    const resolved = updated!.status === "RESOLVED";
    const rejected = updated!.status === "REJECTED";
    if (resolved || rejected) {
      await emitDecisionNotice({
        userId: ticket.userId,
        kind: "TICKET",
        status: rejected ? "REJECTED" : "APPROVED",
        title: rejected
          ? `Ticket ${ticket.ticketNumber} rejected ❌`
          : `Ticket ${ticket.ticketNumber} resolved ✅`,
        message: rejected
          ? `Your ${ticket.category.replace(/_/g, " ").toLowerCase()} ticket was rejected.`
          : `Your ${ticket.category.replace(/_/g, " ").toLowerCase()} ticket has been resolved.`,
        notes: body.resolution ?? null,
        entityId: id,
        actorName: staff.name,
      });
    }

    return ok({ ticket: updated });
  } catch (error) {
    return handleError(error);
  }
}

/**
 * DELETE /api/tickets?id=1&scope=messages|ticket
 * scope=messages -> "Remove / Clear Chat": wipes the thread, keeps the ticket.
 * scope=ticket   -> removes the whole ticket (staff only). Agents never can.
 */
export async function DELETE(request: Request) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const id = Number(url.searchParams.get("id") ?? 0);
    const scope = url.searchParams.get("scope") === "ticket" ? "ticket" : "messages";
    if (!id) return fail("id required", 422);

    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
    if (!ticket) return fail("Ticket not found", 404);

    if (scope === "ticket") {
      if (!isStaff(user.role)) return fail("Only Admin, HR or Manager can delete a ticket", 403);
      await db.delete(ticketMessages).where(eq(ticketMessages.ticketId, id));
      await db.delete(tickets).where(eq(tickets.id, id));
      await audit({
        actorId: user.id,
        actorRole: user.role,
        action: "TICKET_DELETED",
        detail: `${ticket.ticketNumber}`,
      });
      return ok({ deleted: true });
    }

    // Clear chat: the ticket owner or staff may wipe the conversation.
    if (ticket.userId !== user.id && !isStaff(user.role)) return fail("Not permitted", 403);
    await db.delete(ticketMessages).where(eq(ticketMessages.ticketId, id));
    await db
      .update(tickets)
      .set({ updatedAt: new Date() })
      .where(eq(tickets.id, id));
    await db.insert(ticketMessages).values({
      ticketId: id,
      fromUserId: user.id,
      body: "Chat history was cleared.",
    });
    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: "TICKET_CHAT_CLEARED",
      detail: `${ticket.ticketNumber}`,
      meta: { ticketId: id },
    });
    return ok({ cleared: true });
  } catch (error) {
    return handleError(error);
  }
}

/** PUT: post a reply inside the private ticket thread. */
export async function PUT(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as { id?: number; message?: string; attachmentUrl?: string };
    const id = Number(body.id ?? 0);
    const message = (body.message ?? "").trim();
    if (!id) return fail("id required", 422);
    if (!message && !body.attachmentUrl) return fail("Message is empty", 422);

    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, id)).limit(1);
    if (!ticket) return fail("Ticket not found", 404);
    // Strictly 1-on-1: the ticket owner or staff.
    if (ticket.userId !== user.id && !isStaff(user.role)) return fail("Not permitted", 403);

    const [msg] = await db
      .insert(ticketMessages)
      .values({
        ticketId: id,
        fromUserId: user.id,
        body: message || "(attachment)",
        attachmentUrl: body.attachmentUrl ?? null,
      })
      .returning();

    await db
      .update(tickets)
      .set({ updatedAt: new Date(), status: isStaff(user.role) ? "WAITING_AGENT" : ticket.status === "RESOLVED" ? "OPEN" : ticket.status })
      .where(eq(tickets.id, id));

    if (ticket.userId !== user.id) {
      await db.insert(notifications).values({
        title: `Reply on ${ticket.ticketNumber}`,
        body: message.slice(0, 140),
        audienceRole: "ALL",
        targetUserId: ticket.userId,
        sentBy: user.id,
      });
    }

    return ok({ message: msg }, 201);
  } catch (error) {
    return handleError(error);
  }
}
