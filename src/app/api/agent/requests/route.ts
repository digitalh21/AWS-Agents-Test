import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { leadRequests, niches } from "@/db/schema";
import { audit, fail, handleError, ok } from "@/lib/api";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await db
      .select({
        id: leadRequests.id,
        quantity: leadRequests.quantity,
        status: leadRequests.status,
        note: leadRequests.note,
        createdAt: leadRequests.createdAt,
        nicheName: niches.name,
      })
      .from(leadRequests)
      .leftJoin(niches, eq(niches.id, leadRequests.nicheId))
      .where(eq(leadRequests.userId, user.id))
      .orderBy(desc(leadRequests.createdAt))
      .limit(25);
    return ok({ rows });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as { quantity?: number; nicheId?: number; note?: string };
    const quantity = Math.max(1, Math.min(200, Number(body.quantity ?? 10)));
    const [row] = await db
      .insert(leadRequests)
      .values({
        userId: user.id,
        nicheId: body.nicheId ? Number(body.nicheId) : user.primaryNicheId,
        quantity,
        note: body.note ?? null,
        status: "PENDING",
      })
      .returning();
    if (!row) return fail("Could not create request", 500);
    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: "LEAD_REQUEST_CREATED",
      detail: `${quantity} leads requested`,
    });
    return ok({ request: row });
  } catch (error) {
    return handleError(error);
  }
}
