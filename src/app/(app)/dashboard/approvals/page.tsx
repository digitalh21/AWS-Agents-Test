import { redirect } from "next/navigation";
import { requireStaffPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Testing alias: /dashboard/approvals -> Approvals & Proof Review Center. */
export default async function DashboardApprovalsPage() {
  await requireStaffPage();
  redirect("/approvals");
}
