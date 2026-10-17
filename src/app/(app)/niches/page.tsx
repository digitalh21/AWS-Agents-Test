import { NicheManagerPanel } from "@/components/staff/niche-manager-panel";
import { requireStaffPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function NichesPage() {
  await requireStaffPage();
  return <NicheManagerPanel />;
}
