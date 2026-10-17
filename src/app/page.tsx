import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { landingRoute } from "@/lib/rbac";
import { ensureSeed } from "@/lib/seed";

export const dynamic = "force-dynamic";

export default async function Home() {
  await ensureSeed().catch(() => undefined);
  const user = await getSessionUser();
  redirect(user ? landingRoute(user.role) : "/login");
}
