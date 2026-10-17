import { AutomationPanel } from "@/components/staff/automation-panel";
import { requireStaffPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AutomationPage() {
  await requireStaffPage();
  return <AutomationPanel />;
}
