import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Testing alias: /dashboard/tickets -> Help Desk & Complaints. */
export default async function DashboardTicketsPage() {
  await requireUser();
  redirect("/tickets");
}
