import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { broadcastTemplates } from "@/db/schema";
import { audit, fail, handleError, ok } from "@/lib/api";
import { requireRole, requireStaff } from "@/lib/auth";
import { ensureTables } from "@/db/bootstrap";

export const dynamic = "force-dynamic";

/**
 * Broadcast Templates manager (management only).
 *
 * GET returns all templates and lazily installs the pre-made starter set on
 * first use. POST/PATCH/DELETE let management create and edit custom ones.
 * "Use" on the client simply pre-fills the New Broadcast form from a row.
 */
const PREMADE: Array<{
  title: string;
  body: string;
  kind: "POPUP" | "BANNER";
  imageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
}> = [
  {
    title: "Daily Huddle in 15 Minutes",
    body: "Team, our daily huddle starts in 15 minutes. Please wrap up your current call, keep today's closure numbers handy, and join with your pipeline update ready.",
    kind: "POPUP",
  },
  {
    title: "Fresh Lead Batch Assigned",
    body: "A new batch of leads has been dropped into the pool for your niche. First touches are expected within the next 2 hours — open your console and start dialing.",
    kind: "POPUP",
  },
  {
    title: "Payout Cycle Notice",
    body: "This week's payout cycle closes Friday 6 PM IST. Make sure your KYC documents and bank/UPI details are verified — unverified accounts roll over to the next cycle.",
    kind: "BANNER",
  },
  {
    title: "Weekend Target Push",
    body: "Weekend sprint is ON. Everyone who closes 3+ deals by Sunday night earns the Tier-5 accelerator bonus on top of regular commission. Let's finish the week strong!",
    kind: "POPUP",
  },
  {
    title: "KYC Documents Pending",
    body: "Reminder: agents with pending KYC (Aadhaar, PAN or marksheet) will have payouts paused from Monday. Upload your documents today from Profile → KYC.",
    kind: "BANNER",
  },
];

async function ensurePremadeTemplates() {
  const rows = await db
    .select({ id: broadcastTemplates.id })
    .from(broadcastTemplates)
    .limit(1);
  if (rows.length > 0) return;
  for (const t of PREMADE) {
    await db.insert(broadcastTemplates).values({
      title: t.title,
      body: t.body,
      kind: t.kind,
      imageUrl: t.imageUrl ?? null,
      videoUrl: t.videoUrl ?? null,
      audioUrl: t.audioUrl ?? null,
      createdBy: null,
    });
  }
}

/** GET — staff: list templates (auto-seeding the pre-made set when empty). */
export async function GET() {
  try {
    await ensureTables();
    await requireStaff();
    await ensurePremadeTemplates();
    const rows = await db
      .select()
      .from(broadcastTemplates)
      .orderBy(desc(broadcastTemplates.createdAt))
      .limit(200);
    return ok({ rows });
  } catch (error) {
    return handleError(error);
  }
}

/** POST — staff: create a custom template. */
export async function POST(request: Request) {
  try {
    await ensureTables();
    const staff = await requireStaff();
    const body = (await request.json()) as {
      title?: string;
      body?: string;
      kind?: string;
      imageUrl?: string | null;
      videoUrl?: string | null;
      audioUrl?: string | null;
    };
    const title = (body.title ?? "").trim();
    const text = (body.body ?? "").trim();
    if (title.length < 3) return fail("Title must be at least 3 characters", 422);
    if (text.length < 3) return fail("Body must be at least 3 characters", 422);

    const clean = (v: unknown) => {
      if (typeof v !== "string") return null;
      const t = v.trim();
      return /^https?:\/\//i.test(t) ? t.slice(0, 2000) : null;
    };

    const [row] = await db
      .insert(broadcastTemplates)
      .values({
        title,
        body: text,
        kind: body.kind === "BANNER" ? "BANNER" : "POPUP",
        imageUrl: clean(body.imageUrl),
        videoUrl: clean(body.videoUrl),
        audioUrl: clean(body.audioUrl),
        createdBy: staff.id,
        updatedBy: staff.id,
      })
      .returning();

    await audit({
      actorId: staff.id,
      actorRole: staff.role,
      action: "BROADCAST_TEMPLATE_CREATED",
      detail: title,
      meta: { templateId: row!.id },
    });
    return ok({ template: row }, 201);
  } catch (error) {
    return handleError(error);
  }
}

/** PATCH — staff: edit a template (including the pre-made ones). */
export async function PATCH(request: Request) {
  try {
    await ensureTables();
    const staff = await requireStaff();
    const body = (await request.json()) as {
      id?: number;
      title?: string;
      body?: string;
      kind?: string;
      imageUrl?: string | null;
      videoUrl?: string | null;
      audioUrl?: string | null;
    };
    const id = Number(body.id ?? 0);
    if (!id) return fail("id is required", 422);

    const clean = (v: unknown) => {
      if (typeof v !== "string") return null;
      const t = v.trim();
      return /^https?:\/\//i.test(t) ? t.slice(0, 2000) : null;
    };

    const patch: Record<string, unknown> = { updatedAt: new Date(), updatedBy: staff.id };
    if (typeof body.title === "string" && body.title.trim().length >= 3) patch.title = body.title.trim();
    if (typeof body.body === "string" && body.body.trim().length >= 3) patch.body = body.body.trim();
    if (body.kind === "BANNER" || body.kind === "POPUP") patch.kind = body.kind;
    if (body.imageUrl !== undefined) patch.imageUrl = clean(body.imageUrl);
    if (body.videoUrl !== undefined) patch.videoUrl = clean(body.videoUrl);
    if (body.audioUrl !== undefined) patch.audioUrl = clean(body.audioUrl);

    const [row] = await db
      .update(broadcastTemplates)
      .set(patch)
      .where(eq(broadcastTemplates.id, id))
      .returning();
    if (!row) return fail("Template not found", 404);

    await audit({
      actorId: staff.id,
      actorRole: staff.role,
      action: "BROADCAST_TEMPLATE_UPDATED",
      detail: row.title,
      meta: { templateId: id },
    });
    return ok({ template: row });
  } catch (error) {
    return handleError(error);
  }
}

/** DELETE — Admin only: remove a template. */
export async function DELETE(request: Request) {
  try {
    await ensureTables();
    const admin = await requireRole(["ADMIN"]);
    const id = Number(new URL(request.url).searchParams.get("id") ?? 0);
    if (!id) return fail("id is required", 422);
    await db.delete(broadcastTemplates).where(eq(broadcastTemplates.id, id));
    await audit({
      actorId: admin.id,
      actorRole: admin.role,
      action: "BROADCAST_TEMPLATE_DELETED",
      detail: `template #${id}`,
    });
    return ok({ deleted: true });
  } catch (error) {
    return handleError(error);
  }
}
