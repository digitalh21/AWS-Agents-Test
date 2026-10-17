import { AuditTrail } from "@/components/staff/audit-trail";
import { requireStaffPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AuditLogsPage() {
  await requireStaffPage();
  return <AuditTrail />;
}
