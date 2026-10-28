import { AgentsAdmin } from "@/components/staff/agents-admin";
import { requireStaffPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  await requireStaffPage();
  return <AgentsAdmin />;
}
