import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { fail, handleError, ok, audit } from "@/lib/api";
import { setSessionCookie, verifyPassword, type Role } from "@/lib/auth";
import { ensureSeed } from "@/lib/seed";
import { seedDemoUsersIfEmpty } from "@/lib/demo-users";
import { landingRoute } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await ensureSeed();
    // First-run self-heal: on a completely empty database (e.g. a fresh
    // Supabase project) materialize the demo accounts so the documented
    // demo credentials on the login page work out of the box.
    await seedDemoUsersIfEmpty().catch(() => false);
    const body = (await request.json()) as { email?: string; password?: string };
    const email = (body.email ?? "").trim().toLowerCase();
    const password = body.password ?? "";
    if (!email || !password) return fail("Email and password are required", 422);

    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!user || !verifyPassword(password, user.passwordHash)) return fail("Invalid credentials", 401);
    if (!user.isActive) return fail("Account disabled. Contact HR.", 403);

    await setSessionCookie(user.id);
    await db.update(users).set({ isOnline: true, lastSeenAt: new Date() }).where(eq(users.id, user.id));
    await audit({
      actorId: user.id,
      actorRole: user.role,
      action: "AUTH_LOGIN",
      detail: `${user.name} signed in`,
    });

    return ok({
      user: { id: user.id, name: user.name, role: user.role as Role, email: user.email },
      redirect: landingRoute(user.role),
    });
  } catch (error) {
    return handleError(error);
  }
}
