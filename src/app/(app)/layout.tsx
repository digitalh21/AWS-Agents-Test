import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { AppShell } from "@/components/app-shell";
import { SecurityGuard } from "@/components/shared/security-guard";
import { getImpersonatorId, getSessionUser } from "@/lib/auth";
import { navForRole } from "@/lib/rbac";
import { nichesForRole } from "@/lib/queries";
import { ensureSeed } from "@/lib/seed";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  await ensureSeed().catch(() => undefined);
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // Management impersonation: session is the agent, the signed cookie holds
  // the original staff id — surface a "Return to Management Role" bar.
  const impersonatorId = await getImpersonatorId();
  let impersonatorName: string | null = null;
  if (impersonatorId) {
    const [staff] = await db
      .select({ name: users.name, role: users.role })
      .from(users)
      .where(eq(users.id, impersonatorId))
      .limit(1);
    if (staff) impersonatorName = staff.name;
  }

  // Agents only see niches marked "Visible to Agents"; staff always see all of them.
  const { visible: nicheRows } = await nichesForRole(user.role);

  const navItems = navForRole(user.role).map((n) => ({ href: n.href, label: n.label, icon: n.icon }));

  return (
    /* SecurityGuard WRAPS the app: it provides the interaction context used
       by the live counter, the quota gate and the lead-open telemetry. */
    <SecurityGuard role={user.role}>
    <AppShell
      user={{ id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone }}
      niches={nicheRows}
      navItems={navItems}
      impersonator={impersonatorName ? { name: impersonatorName } : null}
    >
      {children}
    </AppShell>
    </SecurityGuard>
  );
}
