import { FieldPermissionsPanel } from "@/components/staff/field-permissions-panel";
import { requireStaffPage } from "@/lib/auth";
import { getFieldPolicy } from "@/lib/field-visibility";
import { ensureSeed } from "@/lib/seed";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const staff = await requireStaffPage();
  await ensureSeed().catch(() => undefined);
  // Server-render the matrix so it paints immediately (no client round trip).
  const policy = await getFieldPolicy();
  return (
    <FieldPermissionsPanel
      initialPolicy={policy}
      viewerRole={staff.role}
      canEdit={staff.role === "ADMIN" || staff.role === "HR"}
    />
  );
}
