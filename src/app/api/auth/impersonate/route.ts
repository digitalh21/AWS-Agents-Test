import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { audit, fail, handleError, ok } from "@/lib/api";
import {
  asUserId,
  clearImpersonatorCookie,
  clearSessionCookie,
  getImpersonatorId,
  requireStaff,
  setImpersonatorCookie,
  setSessionCookie,
} from "@/lib/auth";
import { landingRoute } from "@/lib/rbac";

export const dynamic = "force-dynamic";

/**
 * Secure management impersonation.
 *
 * POST   { userId } — staff swaps their session to the target account while
 *         their own id is kept in a separate signed cookie so they can return.
 *         Targets are restricted to non-staff AGENT accounts ("Switch as User").
 * DELETE          — ends the impersonation and restores the staff session.
 *
 * Every start/end is written to the audit trail.
 */
export async function POST(request: Request) {
  try {
    const staff = await requireStaff();
    const body = (await request.json()) as { userId?: string };
    const targetId = asUserId(body.userId);
    if (!targetId) return fail("userId is required", 422);

    if (targetId === staff.id) return fail("You are already signed in as yourself", 422);

    const [target] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
    if (!target) return fail("User not found", 404);
    if (!target.isActive) return fail("That account is disabled", 409);
    if (target.role !== "AGENT") return fail("Preview is currently supported for agent accounts", 422);

    await setImpersonatorCookie(staff.id);
    await setSessionCookie(target.id);

    await audit({
      actorId: staff.id,
      actorRole: staff.role,
      action: "IMPERSONATION_STARTED",
      detail: `${staff.name} is viewing as ${target.name}`,
      meta: { targetId: target.id },
    });

    return ok({
      impersonating: true,
      as: { id: target.id, name: target.name, role: target.role },
      redirect: landingRoute(target.role),
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function DELETE() {
  try {
    const staffId = await getImpersonatorId();
    if (!staffId) return fail("Not impersonating anyone", 409);

    const [staff] = await db.select().from(users).where(eq(users.id, staffId)).limit(1);
    if (!staff || !staff.isActive) {
      await clearSessionCookie();
      await clearImpersonatorCookie();
      return fail("Original account unavailable — signed out", 410);
    }

    await setSessionCookie(staff.id);
    await clearImpersonatorCookie();

    await audit({
      actorId: staff.id,
      actorRole: staff.role,
      action: "IMPERSONATION_ENDED",
      detail: `${staff.name} returned to their management role`,
    });

    return ok({ impersonating: false, redirect: landingRoute(staff.role), user: { id: staff.id, name: staff.name, role: staff.role } });
  } catch (error) {
    return handleError(error);
  }
}
