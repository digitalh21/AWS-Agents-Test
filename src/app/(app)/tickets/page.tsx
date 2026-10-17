import { TicketDesk } from "@/components/shared/ticket-desk";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function TicketsPage() {
  // Both agents and staff land here; the desk adapts to the role.
  await requireUser();
  return <TicketDesk />;
}
