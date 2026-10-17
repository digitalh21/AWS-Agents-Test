import { ApprovalsCenter } from "@/components/staff/approvals-center";
import { requireStaffPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  await requireStaffPage();
  return <ApprovalsCenter />;
}
