import { PipelineBoard } from "@/components/staff/pipeline-board";
import { PipelineViewSwitch } from "@/components/staff/pipeline-view-switch";
import { requireStaffPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Testing alias: /dashboard/admin -> Admin / HR / Manager operations console. */
export default async function DashboardAdminPage() {
  await requireStaffPage();
  const view = "board";
  return (
    <div>
      <PipelineViewSwitch initial={view} />
      <PipelineBoard />
    </div>
  );
}
