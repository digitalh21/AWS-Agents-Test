import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Testing alias: /dashboard/profile -> Agent Profile & KYC. */
export default async function DashboardProfilePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  // staff get their own profile context via the shared view
  redirect(user.role === "AGENT" ? "/agent/profile" : `/agents/${user.id}`);
}
