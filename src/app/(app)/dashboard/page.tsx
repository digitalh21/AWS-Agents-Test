import { Dashboard } from "@/components/shared/dashboard";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // Every role lands on the same summary view; the payload adapts to the role.
  await requireUser();
  return <Dashboard />;
}
