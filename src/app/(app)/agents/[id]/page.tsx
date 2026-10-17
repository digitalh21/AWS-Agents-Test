import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AgentProfileView } from "@/components/agent/agent-profile-view";
import { requireStaffPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AgentProfileAdminPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaffPage();
  const { id } = await params;

  return (
    <div>
      <div className="flex items-center gap-2 border-b bg-white px-3 py-2 sm:px-4 lg:px-6">
        <Link
          href="/agents"
          className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All agents
        </Link>
      </div>
      <AgentProfileView targetUserId={id} />
    </div>
  );
}
