import { AgentProfileView } from "@/components/agent/agent-profile-view";
import { requireAgentPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AgentProfilePage() {
  await requireAgentPage();
  return <AgentProfileView />;
}
