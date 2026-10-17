import { CommissionPanel } from "@/components/staff/commission-panel";
import { requireStaffPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function CommissionPage() {
  await requireStaffPage();
  return <CommissionPanel />;
}
