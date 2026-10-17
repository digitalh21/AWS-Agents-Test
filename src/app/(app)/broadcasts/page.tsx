import { BroadcastsPanel } from "@/components/staff/broadcasts-panel";
import { requireStaffPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function BroadcastsPage() {
  await requireStaffPage();
  return <BroadcastsPanel />;
}
