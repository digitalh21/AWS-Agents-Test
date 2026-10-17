import { AgentConsole } from "@/components/agent/agent-console";
import { requireAgentPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Testing alias: /dashboard/agent -> Agent workspace. */
export default async function DashboardAgentPage() {
  await requireAgentPage();
  return <AgentConsole />;
}
