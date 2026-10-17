import { redirect } from "next/navigation";
import { requireStaffPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Testing alias: /dashboard/broadcasts -> Banners & Popup Broadcasts. */
export default async function DashboardBroadcastsPage() {
  await requireStaffPage();
  redirect("/broadcasts");
}
