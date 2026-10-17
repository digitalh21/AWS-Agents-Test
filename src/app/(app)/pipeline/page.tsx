import { LeadPipeline } from "@/components/staff/lead-pipeline";
import { PipelineBoard } from "@/components/staff/pipeline-board";
import { PipelineViewSwitch } from "@/components/staff/pipeline-view-switch";
import { requireStaffPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  await requireStaffPage();
  const view = (await searchParams).view === "table" ? "table" : "board";

  return (
    <div>
      <PipelineViewSwitch initial={view} />
      {view === "table" ? <LeadPipeline /> : <PipelineBoard />}
    </div>
  );
}
