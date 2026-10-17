import { AgentConsole } from "@/components/agent/agent-console";
import { requireAgentPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AgentDashboardPage() {
  await requireAgentPage();
  return <AgentConsole />;
}
