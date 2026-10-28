import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { clearSessionCookie, getSessionUser } from "@/lib/auth";
import { handleError, ok } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const user = await getSessionUser();
    if (user) {
      await db.update(users).set({ isOnline: false }).where(eq(users.id, user.id));
    }
    await clearSessionCookie();
    return ok({ ok: true });
  } catch (error) {
    return handleError(error);
  }
}
