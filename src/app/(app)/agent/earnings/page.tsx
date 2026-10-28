import { AgentEarnings } from "@/components/agent/agent-earnings";
import { requireAgentPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AgentEarningsPage() {
  await requireAgentPage();
  return <AgentEarnings />;
}
