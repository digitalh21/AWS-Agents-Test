import { AgentSlabsPanel } from "@/components/staff/agent-slabs-panel";
import { requireStaffPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AgentSlabsPage() {
  await requireStaffPage();
  return <AgentSlabsPanel />;
}
