import { FilesManager } from "@/components/staff/files-manager";
import { requireStaffPage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function FilesPage() {
  await requireStaffPage();
  return <FilesManager />;
}
