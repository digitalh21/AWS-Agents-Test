import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { decisionNotices, notifications } from "@/db/schema";

export type DecisionKind =
  | "REPLACE_LEAD"
  | "LEAD_ERROR"
  | "PAYMENT_PROOF"
  | "TICKET"
  | "KYC"
  | "COMMISSION"
  | "CORRECTION";

export type DecisionStatus = "APPROVED" | "REJECTED" | "PENDING" | "INFO";

/**
 * Fires the automated management-response alert for an agent.
 * Writes BOTH a decision notice (drives the blocking popup) and a regular
 * notification (so it also shows in the Notification Center history).
 */
export async function emitDecisionNotice(input: {
  userId: string;
  kind: DecisionKind;
  status: DecisionStatus;
  title: string;
  message: string;
  notes?: string | null;
  leadId?: number | null;
  entityId?: number | null;
  actorName?: string | null;
}) {
  const notes = input.notes?.trim() ? input.notes.trim() : null;

  await db.insert(decisionNotices).values({
    userId: input.userId,
    kind: input.kind,
    status: input.status,
    title: input.title,
    message: input.message,
    notes,
    leadId: input.leadId ?? null,
    entityId: input.entityId ?? null,
    actorName: input.actorName ?? null,
  });

  await db.insert(notifications).values({
    title: input.title,
    body: notes ? `${input.message} — Notes: ${notes}` : input.message,
    audienceRole: "ALL",
    targetUserId: input.userId,
  });
}

/** The agent's unread decision notices — these block the screen until dismissed. */
export async function pendingDecisionNotices(userId: string) {
  return db
    .select()
    .from(decisionNotices)
    .where(and(eq(decisionNotices.userId, userId), sql`${decisionNotices.readAt} is null`))
    .orderBy(desc(decisionNotices.createdAt))
    .limit(5);
}

/** Full history for the agent's popup/notification log. */
export async function decisionHistory(userId: string, limit = 25) {
  return db
    .select()
    .from(decisionNotices)
    .where(eq(decisionNotices.userId, userId))
    .orderBy(desc(decisionNotices.createdAt))
    .limit(limit);
}
