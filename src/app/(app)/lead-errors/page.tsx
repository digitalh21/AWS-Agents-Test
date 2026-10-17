import { LeadErrorsPanel } from "@/components/staff/lead-errors-panel";
import { requireStaffPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LeadErrorsPage() {
  await requireStaffPage();
  return <LeadErrorsPanel />;
}
