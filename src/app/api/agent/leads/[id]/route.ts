import { and, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  callLogs,
  correctionRequests,
  dealApprovals,
  leads,
  niches,
  notifications,
  templates,
  uploads,
  users,
} from "@/db/schema";
import { audit, fail, handleError, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { applyFieldPolicy, getFieldPolicy, modeFor, projectLead } from "@/lib/field-visibility";
import { agentHistoryVisible } from "@/lib/settings";
import { bumpDailyActivity } from "@/lib/activity";
import { resolveCommission } from "@/lib/commission";
import { historyAccessRequests } from "@/db/schema";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function loadLead(id: number) {
  const [row] = await db
    .select({ lead: leads, nicheName: niches.name, nicheSlug: niches.slug })
    .from(leads)
    .innerJoin(niches, eq(niches.id, leads.nicheId))
    .where(eq(leads.id, id))
    .limit(1);
  return row;
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const policy = await getFieldPolicy();
    const id = Number((await params).id);
    if (!Number.isFinite(id)) return fail("Invalid lead id", 400);

    const row = await loadLead(id);
    if (!row) return fail("Lead not found", 404);

    // Universal "Open Lead": an agent may READ any lead they can reference from a
    // ticket, error report or decision notice. Write actions below stay locked to
    // leads actually assigned to them.
    if (row.lead.assignedAgentId !== user.id) {
      const [xNotes, xTpl, xProof] = await Promise.all([
        db
          .select({
            id: callLogs.id,
            status: callLogs.status,
            notes: callLogs.notes,
            durationSeconds: callLogs.durationSeconds,
            createdAt: callLogs.createdAt,
            callStartedAt: callLogs.callStartedAt,
          })
          .from(callLogs)
          .where(and(eq(callLogs.leadId, id), ne(callLogs.agentId, user.id), ne(callLogs.status, "DIALING")))
          .orderBy(desc(callLogs.createdAt))
          .limit(10),
        db
          .select({ id: templates.id, title: templates.title, body: templates.body })
          .from(templates)
          .where(sql`${templates.nicheId} is null or ${templates.nicheId} = ${row.lead.nicheId}`)
          .orderBy(templates.id),
        db
          .select({
            id: uploads.id,
            kind: uploads.kind,
            fileName: uploads.fileName,
            mimeType: uploads.mimeType,
            createdAt: uploads.createdAt,
          })
          .from(uploads)
          .where(eq(uploads.leadId, id))
          .orderBy(desc(uploads.createdAt))
          .limit(20),
      ]);

      const xFields = applyFieldPolicy(
        projectLead({
          ...row.lead,
          nicheName: row.nicheName,
          categoryName: row.nicheName,
          // read-only cross-lead view never exposes a dialable number
          phone: `${row.lead.phone.slice(0, 2)}•••••${row.lead.phone.slice(-2)}`,
          phoneNormalized: null,
        } as Record<string, unknown>),
        policy,
        user.role,
      );

      return ok({
        lead: {
          id: row.lead.id,
          accessUnlocked: false,
          callCount: row.lead.callCount,
          dealAmount: row.lead.dealAmount,
          contactName: row.lead.contactName,
          lastTouchedAt: row.lead.lastTouchedAt,
          assignedAt: row.lead.assignedAt,
          assignedAgentId: row.lead.assignedAgentId,
          ...xFields,
        },
        readOnly: true,
        assignedToMe: false,
        canDial: false,
        dialTarget: null,
        fieldPolicy: Object.fromEntries(
          Object.keys(policy)
            .filter((k) => modeFor(policy, k, user.role) !== "VISIBLE")
            .map((k) => [k, modeFor(policy, k, user.role)]),
        ),
        locked: true,
        submitted: true,
        history: { allowed: false, pastCount: xNotes.length, requests: [] },
        pastNotes: xNotes,
        myLogs: [],
        templates: xTpl,
        uploads: xProof,
        correction: [],
        deals: [],
        lastRejection: null,
        proofLocked: true,
        commission: null,
      });
    }

    const historyAllowed = await agentHistoryVisible();
    const [pastNotes, myLogs, tpl, proof, histReqs, deals, correction] = await Promise.all([
      // Past-agent notes are returned ONLY when the admin toggle allows it.
      historyAllowed
        ? db
            .select({
              id: callLogs.id,
              status: callLogs.status,
              notes: callLogs.notes,
              durationSeconds: callLogs.durationSeconds,
              createdAt: callLogs.createdAt,
              callStartedAt: callLogs.callStartedAt,
            })
            .from(callLogs)
            .where(and(eq(callLogs.leadId, id), ne(callLogs.agentId, user.id), ne(callLogs.status, "DIALING")))
            .orderBy(desc(callLogs.createdAt))
            .limit(15)
        : Promise.resolve([] as Array<{ id: number; status: string; notes: string | null; durationSeconds: number; createdAt: string; callStartedAt: string | null }>),
      db
        .select()
        .from(callLogs)
        .where(and(eq(callLogs.leadId, id), eq(callLogs.agentId, user.id)))
        .orderBy(desc(callLogs.createdAt))
        .limit(5),
      db
        .select({ id: templates.id, title: templates.title, body: templates.body })
        .from(templates)
        .where(sql`${templates.nicheId} is null or ${templates.nicheId} = ${row.lead.nicheId}`)
        .orderBy(templates.id),
      db
        .select({
          id: uploads.id,
          kind: uploads.kind,
          fileName: uploads.fileName,
          mimeType: uploads.mimeType,
          createdAt: uploads.createdAt,
        })
        .from(uploads)
        .where(eq(uploads.leadId, id))
        .orderBy(desc(uploads.createdAt))
        .limit(20),
      db
        .select({
          id: historyAccessRequests.id,
          status: historyAccessRequests.status,
          resolvedNote: historyAccessRequests.resolvedNote,
          createdAt: historyAccessRequests.createdAt,
        })
        .from(historyAccessRequests)
        .where(and(eq(historyAccessRequests.leadId, id), eq(historyAccessRequests.userId, user.id)))
        .orderBy(desc(historyAccessRequests.createdAt))
        .limit(3),
      db
        .select({
          id: dealApprovals.id,
          status: dealApprovals.status,
          amount: dealApprovals.amount,
          commission: dealApprovals.commission,
          rejectionReason: dealApprovals.rejectionReason,
          reviewNote: dealApprovals.reviewNote,
          decidedAt: dealApprovals.decidedAt,
          createdAt: dealApprovals.createdAt,
        })
        .from(dealApprovals)
        .where(eq(dealApprovals.leadId, id))
        .orderBy(desc(dealApprovals.createdAt)),
      db
        .select({
          id: correctionRequests.id,
          status: correctionRequests.status,
          reason: correctionRequests.reason,
          createdAt: correctionRequests.createdAt,
        })
        .from(correctionRequests)
        .where(and(eq(correctionRequests.leadId, id), eq(correctionRequests.userId, user.id)))
        .orderBy(desc(correctionRequests.createdAt))
        .limit(5),
    ]);

    const locked = !row.lead.accessUnlocked;
    // Append-only timeline: a correction approval never deletes history. The form
    // unlocks when the newest APPROVED correction is newer than the newest report.
    const latestApproved = correction.find((c) => c.status === "APPROVED");
    const latestLog = myLogs.find((l) => l.status !== "DIALING");
    const submitted = Boolean(latestLog) && !(latestApproved && new Date(latestApproved.createdAt) > new Date(latestLog!.createdAt));
    const rejectedFlag = deals.some((d) => d.status === "REJECTED");

    // Dual-layer masking: (1) per-lead access lock, (2) admin field visibility matrix.
    const raw = {
      ...row.lead,
      nicheName: row.nicheName,
      categoryName: row.nicheName,
      phone: locked ? `${row.lead.phone.slice(0, 2)}•••••${row.lead.phone.slice(-2)}` : row.lead.phone,
      phoneNormalized: locked ? null : row.lead.phoneNormalized ?? row.lead.phone,
    } as Record<string, unknown>;

    const fields = applyFieldPolicy(projectLead(raw), policy, user.role);

    return ok({
      lead: {
        // engine metadata
        id: row.lead.id,
        accessUnlocked: row.lead.accessUnlocked,
        callCount: row.lead.callCount,
        dealAmount: row.lead.dealAmount,
        contactName: row.lead.contactName,
        lastTouchedAt: row.lead.lastTouchedAt,
        assignedAt: row.lead.assignedAt,
        archivedForAgent: row.lead.archivedForAgent,
        cycleCount: row.lead.cycleCount,
        // policy-projected fields
        ...fields,
      },
      canDial: modeFor(policy, "phone", user.role) !== "HIDDEN" && !locked,
      commission: await resolveCommission(user.id),
      dialTarget: modeFor(policy, "phone_normalized", user.role) === "HIDDEN" ? (locked ? null : row.lead.phone) : locked ? null : row.lead.phoneNormalized ?? row.lead.phone,
      fieldPolicy: Object.fromEntries(
        Object.keys(policy)
          .filter((k) => modeFor(policy, k, user.role) !== "VISIBLE")
          .map((k) => [k, modeFor(policy, k, user.role)]),
      ),
      locked,
      submitted,
      lastRejection: (() => {
        const rejected = [...deals].reverse().find((d) => d.status === "REJECTED");
        return rejected
          ? {
              id: rejected.id,
              rejectionReason: rejected.rejectionReason,
              reviewNote: rejected.reviewNote,
              amount: rejected.amount,
              decidedAt: rejected.decidedAt,
            }
          : null;
      })(),
      proofLocked: rejectedFlag,
      history: {
        allowed: historyAllowed,
        pastCount: pastNotes.length,
        requests: histReqs,
      },
      pastNotes,
      myLogs,
      templates: tpl,
      uploads: proof,
      correction,
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const user = await requireUser();
    const policy = await getFieldPolicy();
    const id = Number((await params).id);
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");

    const row = await loadLead(id);
    if (!row) return fail("Lead not found", 404);
    if (row.lead.assignedAgentId !== user.id) return fail("This lead is not assigned to you", 403);

    /* -------------------- native dialer start -------------------- */
    if (action === "call-start") {
      if (!row.lead.accessUnlocked) return fail("Lead details locked. Request access from Admin.", 403);
      const [log] = await db
        .insert(callLogs)
        .values({ leadId: id, agentId: user.id, status: "DIALING", callStartedAt: new Date(), notes: null })
        .returning();
      await db
        .update(leads)
        .set({ status: row.lead.status === "NEW" ? "IN_PROGRESS" : row.lead.status, lastTouchedAt: new Date(), updatedAt: new Date() })
        .where(eq(leads.id, id));
      await audit({ actorId: user.id, actorRole: user.role, leadId: id, action: "CALL_STARTED", detail: "Native dialer opened" });
      await bumpDailyActivity(user.id, { callsMade: 1, touchedLeads: 1 });
      return ok({ logId: log.id, startedAt: log.callStartedAt });
    }

    /* -------------------- post-call report -------------------- */
    if (action === "report") {
      const alreadySubmitted = await db
        .select({ id: callLogs.id })
        .from(callLogs)
        .where(and(eq(callLogs.leadId, id), eq(callLogs.agentId, user.id), ne(callLogs.status, "DIALING")))
        .limit(1);
      if (alreadySubmitted.length > 0 && body.force !== true) {
        return fail("Report already submitted. Use 'Request Correction' for any mistake.", 409);
      }

      const status = String(body.status ?? "IN_PROGRESS");
      const notes = String(body.notes ?? "").trim();
      if (notes.length < 3) return fail("Call notes / reason is required.", 422);
      // Proof is the ONLY extra requirement — and only when moving into Payment Approval.
      if (status === "PAYMENT_APPROVAL" && !body.uploadId && !body.proofUrl) {
        return fail("Upload the payment screenshot / proof before sending for approval.", 422);
      }
      const durationSeconds = Math.max(0, Number(body.durationSeconds ?? 0));
      const callStartedAt = body.callStartedAt ? new Date(String(body.callStartedAt)) : null;
      const logId = body.logId ? Number(body.logId) : null;
      const uploadId = body.uploadId ? Number(body.uploadId) : null;

      // The single notes box doubles as the reason and is appended to the timeline.
      const storedNotes = notes;
      const [log] = await db
        .insert(callLogs)
        .values({
          leadId: id,
          agentId: user.id,
          status,
          notes: storedNotes,
          durationSeconds,
          callStartedAt,
          callEndedAt: new Date(),
          whatsappTemplateId: body.whatsappTemplateId ? Number(body.whatsappTemplateId) : null,
          whatsappSent: Boolean(body.whatsappSent),
        })
        .returning();

      if (logId) {
        await db.delete(callLogs).where(and(eq(callLogs.id, logId), eq(callLogs.status, "DIALING")));
      }

      // Section 2 — AUTOMATED UNASSIGNMENT:
      // marking a lead "No Response" or "Reject / Not Interest" releases it back to
      // the unassigned pool for recycling, but the status label is PRESERVED so it
      // appears in the correct Unassigned Pipeline column.
      const autoUnassign = status === "NO_RESPONSE" ? "AUTO_NO_RESPONSE" : status === "REJECTED" ? "AUTO_REJECTED" : null;

      await db
        .update(leads)
        .set({
          status,
          lastTouchedAt: new Date(),
          updatedAt: new Date(),
          callCount: sql`${leads.callCount} + 1`,
          dealAmount: body.dealAmount ? String(body.dealAmount) : row.lead.dealAmount,
          callStatus: body.callStatus ? String(body.callStatus) : row.lead.callStatus,
          callbackAt: body.callbackAt ? new Date(String(body.callbackAt)) : null,
          ...(autoUnassign
            ? { assignedAgentId: null, assignedAt: null, accessUnlocked: false, unassignReason: autoUnassign }
            : {}),
        })
        .where(eq(leads.id, id));

      if (uploadId) {
        await db.update(uploads).set({ leadId: id }).where(eq(uploads.id, uploadId));
      }

      if (status === "PAYMENT_APPROVAL") {
        const [agent] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
        // Agent-entered "Deal Value" — the exact amount the customer paid.
        const amount = Number(body.dealAmount ?? row.lead.dealAmount ?? 0);
        // Tiered slab commission resolved from the agent's APPROVED close count.
        const resolved = await resolveCommission(user.id);
        await db.insert(dealApprovals).values({
          leadId: id,
          agentId: user.id,
          amount: String(amount),
          commission: String(resolved.amount || Number(agent?.commissionPerDeal ?? 0)),
          slabLabel: resolved.slab?.label ?? null,
          slabIndex: resolved.closes,
          proofUrl: body.proofUrl ? String(body.proofUrl) : null,
          proofUploadId: body.uploadId ? Number(body.uploadId) : null,
          agentNote: body.paymentNote ? String(body.paymentNote) : storedNotes,
          status: "PENDING",
        });
        await bumpDailyActivity(user.id, { dealsClosed: 1 });
      } else {
        await bumpDailyActivity(user.id, { statusChanges: 1 });
      }

      if (autoUnassign) {
        await db.insert(notifications).values({
          title: autoUnassign === "AUTO_NO_RESPONSE" ? "Lead auto-unassigned (No Response)" : "Lead auto-unassigned (Not Interested)",
          body: `${user.name} marked ${row.lead.businessName} (${row.lead.leadCode ?? `#${id}`}) as ${status.replace("_", " ")}. It is back in the unassigned pool for re-assignment.`,
          audienceRole: "ALL",
          sentBy: user.id,
        });
      }

      await audit({
        actorId: user.id,
        actorRole: user.role,
        leadId: id,
        action: "CALL_REPORT_SUBMITTED",
        detail: `Status → ${status} · ${notes}${body.callbackAt ? ` · callback ${body.callbackAt}` : ""}`,
        meta: {
          durationSeconds,
          notes,
          callbackAt: body.callbackAt ?? null,
          whatsappSent: Boolean(body.whatsappSent),
        },
      });

      return ok({ logId: log.id, locked: true });
    }

    /* -------------------- "I Lost My Efforts" -> Lost / Returned to Pool -------------------- */
    if (action === "lost-lead") {
      const reason = String(body.reason ?? "").trim();
      if (reason.length < 10) return fail("Please describe why you are returning this lead (min 10 characters).", 422);

      await db
        .update(leads)
        .set({
          status: "LOST",
          assignedAgentId: null,
          assignedAt: null,
          lastTouchedAt: new Date(),
          accessUnlocked: false,
          updatedAt: new Date(),
          // keep the reason on the record for management review
          callStatus: "LOST_BY_AGENT",
          unassignReason: "AGENT_LOST",
        })
        .where(eq(leads.id, id));

      await db.insert(callLogs).values({
        leadId: id,
        agentId: user.id,
        status: "LOST",
        notes: `Returned to pool — ${reason}`,
        durationSeconds: 0,
        callEndedAt: new Date(),
      });

      await db.insert(notifications).values({
        title: "Lead returned to pool",
        body: `${user.name} released ${row.lead.businessName} (${row.lead.leadCode ?? `#${id}`}). Reason: ${reason.slice(0, 140)}`,
        audienceRole: "ALL",
        sentBy: user.id,
      });

      await audit({
        actorId: user.id,
        actorRole: user.role,
        leadId: id,
        action: "LEAD_LOST_RETURNED",
        detail: reason,
      });

      await bumpDailyActivity(user.id, { statusChanges: 1 });
      return ok({ ok: true, status: "LOST" });
    }

    /* -------------------- re-upload after rejection -------------------- */
    if (action === "reupload-proof") {
      const uploadId = body.uploadId ? Number(body.uploadId) : null;
      if (!uploadId && !body.proofUrl) return fail("Attach a new proof file first", 422);

      const [rejected] = await db
        .select({ id: dealApprovals.id })
        .from(dealApprovals)
        .where(and(eq(dealApprovals.leadId, id), eq(dealApprovals.agentId, user.id), eq(dealApprovals.status, "REJECTED")))
        .orderBy(desc(dealApprovals.createdAt))
        .limit(1);

      if (rejected) {
        await db
          .update(dealApprovals)
          .set({
            status: "PENDING",
            proofUrl: body.proofUrl ? String(body.proofUrl) : null,
            proofUploadId: uploadId,
            agentNote: body.paymentNote ? String(body.paymentNote) : null,
            rejectionReason: null,
            reviewedBy: null,
            decidedAt: null,
            createdAt: new Date(),
          })
          .where(eq(dealApprovals.id, rejected.id));
      } else {
        const [agent] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
        const resolved = await resolveCommission(user.id);
        await db.insert(dealApprovals).values({
          leadId: id,
          agentId: user.id,
          amount: String(body.dealAmount ?? row.lead.dealAmount ?? 0),
          commission: String(resolved.amount || Number(agent?.commissionPerDeal ?? 0)),
          slabLabel: resolved.slab?.label ?? null,
          slabIndex: resolved.closes,
          proofUrl: body.proofUrl ? String(body.proofUrl) : null,
          proofUploadId: uploadId,
          agentNote: body.paymentNote ? String(body.paymentNote) : null,
          status: "PENDING",
        });
      }

      await db
        .update(leads)
        .set({ status: "PAYMENT_APPROVAL", updatedAt: new Date(), lastTouchedAt: new Date() })
        .where(eq(leads.id, id));

      await audit({
        actorId: user.id,
        actorRole: user.role,
        leadId: id,
        action: "PROOF_REUPLOADED",
        detail: "Re-submitted after rejection",
      });
      return ok({ ok: true, resubmitted: true });
    }

    /* -------------------- correction request -------------------- */
    if (action === "correction") {
      const reason = String(body.reason ?? "").trim();
      if (reason.length < 5) return fail("Please describe the mistake (min 5 chars)", 422);
      const [cr] = await db
        .insert(correctionRequests)
        .values({
          leadId: id,
          userId: user.id,
          reason,
          requestedStatus: body.requestedStatus ? String(body.requestedStatus) : null,
          status: "PENDING",
        })
        .returning();
      await audit({
        actorId: user.id,
        actorRole: user.role,
        leadId: id,
        action: "CORRECTION_REQUESTED",
        detail: reason,
      });
      await db.insert(notifications).values({
        title: "Correction request raised",
        body: `${user.name} requested a correction on lead #${id}: ${reason.slice(0, 120)}`,
        audienceRole: "ADMIN",
        sentBy: user.id,
      });
      return ok({ request: cr });
    }

    /* -------------------- unlock / re-assign -------------------- */
    if (action === "unlock-request") {
      await audit({
        actorId: user.id,
        actorRole: user.role,
        leadId: id,
        action: "LEAD_ACCESS_REQUESTED",
        detail: "Agent requested prospect details unlock",
      });
      await db.insert(notifications).values({
        title: "Lead access request",
        body: `${user.name} requested unlock for ${row.lead.businessName} (#${id})`,
        audienceRole: "ADMIN",
        sentBy: user.id,
      });
      return ok({ requested: true });
    }

    if (action === "whatsapp-sent") {
      await audit({
        actorId: user.id,
        actorRole: user.role,
        leadId: id,
        action: "WHATSAPP_SENT",
        detail: String(body.templateTitle ?? "Template"),
        meta: { templateId: body.templateId ?? null },
      });
      return ok({ ok: true });
    }

    return fail("Unknown action", 400);
  } catch (error) {
    return handleError(error);
  }
}
