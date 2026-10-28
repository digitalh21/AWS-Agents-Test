"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, History, Loader2, ShieldAlert, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn, dateTime } from "@/lib/utils";

type Notice = {
  id: number;
  kind: string;
  status: string;
  title: string;
  message: string;
  notes: string | null;
  leadId: number | null;
  entityId: number | null;
  actorName: string | null;
  readAt: string | null;
  createdAt: string;
};

const KIND_LABEL: Record<string, string> = {
  REPLACE_LEAD: "Replace Lead",
  LEAD_ERROR: "Lead Error Report",
  PAYMENT_PROOF: "Payment Proof",
  TICKET: "Help Desk Ticket",
  KYC: "KYC Verification",
  COMMISSION: "Commission / Payout",
  CORRECTION: "Correction Request",
};

/**
 * Automated management-response popup.
 * When Admin/HR/Manager approves or rejects anything belonging to the agent,
 * the decision — including management's written notes — blocks the screen until
 * the agent acknowledges it. History is listed below the blocking notice.
 */
export function DecisionNoticeOverlay({ onChanged }: { onChanged?: () => void }) {
  const [pending, setPending] = useState<Notice[]>([]);
  const [history, setHistory] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/decision-notices");
    if (!res.ok) return;
    const json = (await res.json()) as { pending: Notice[]; history: Notice[]; blocking: boolean };
    setPending(json.pending ?? []);
    setHistory(json.history ?? []);
    setOpen(Boolean(json.blocking));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 25000);
    return () => clearInterval(t);
  }, [load]);

  async function dismiss(id?: number) {
    setBusy(true);
    const res = await fetch("/api/decision-notices", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(id ? { id } : { all: true }),
    });
    if (res.ok) {
      await load();
      onChanged?.();
    } else toast.error("Could not dismiss");
    setBusy(false);
  }

  const active = pending[0];
  const rejected = active?.status === "REJECTED";

  if (loading || !active) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && void dismiss(active.id)}>
      <DialogContent className="sm:max-w-lg">
        <div
          className={cn(
            "sticky top-0 z-10 border-b p-4 backdrop-blur",
            rejected ? "border-rose-200 bg-rose-50" : "border-emerald-200 bg-emerald-50",
          )}
        >
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm",
                rejected ? "bg-rose-600" : "bg-emerald-600",
              )}
            >
              {rejected ? <XCircle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("text-sm font-extrabold leading-tight", rejected ? "text-rose-900" : "text-emerald-900")}>
                {active.title}
              </p>
              <p className={cn("mt-0.5 text-[11px] font-medium", rejected ? "text-rose-700" : "text-emerald-700")}>
                Management response · {KIND_LABEL[active.kind] ?? active.kind.replace(/_/g, " ")}
              </p>
            </div>
            <Badge variant={rejected ? "danger" : "success"}>{active.status}</Badge>
          </div>
        </div>

        <div className="space-y-3 p-4">
          {/* decision message */}
          <div
            className={cn(
              "rounded-xl border p-3",
              rejected ? "border-rose-200 bg-white" : "border-emerald-200 bg-white",
            )}
          >
            <p className="text-sm">{active.message}</p>

            {/* management's written notes, verbatim */}
            {active.notes ? (
              <div
                className={cn(
                  "mt-2 rounded-lg border-l-4 p-2.5",
                  rejected ? "border-rose-400 bg-rose-50" : "border-emerald-400 bg-emerald-50",
                )}
              >
                <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Management notes</p>
                <p className="mt-0.5 whitespace-pre-wrap text-xs font-medium text-slate-800">{active.notes}</p>
              </div>
            ) : (
              <p className="mt-2 rounded-lg bg-slate-50 p-2 text-[11px] italic text-muted-foreground">
                No written notes were added.
              </p>
            )}

            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
              <span>Decision by <strong>{active.actorName ?? "Management"}</strong></span>
              <span>·</span>
              <span>{dateTime(active.createdAt)}</span>
              {active.leadId ? (
                <>
                  <span>·</span>
                  <span>lead #{active.leadId}</span>
                </>
              ) : null}
            </div>

            {/* rejection next-step guidance */}
            {rejected ? (
              <div className="mt-2 rounded-lg bg-amber-50 p-2.5">
                <p className="flex items-center gap-1.5 text-[11px] font-bold text-amber-900">
                  <ShieldAlert className="h-3.5 w-3.5" /> What happens next
                </p>
                <p className="mt-0.5 text-[11px] text-amber-800">
                  {active.kind === "KYC"
                    ? "Open your profile and use “Re-upload & Re-submit KYC” to send fresh documents."
                    : active.kind === "PAYMENT_PROOF"
                      ? "Open the lead and use “Re-upload Proof” to send a clearer screenshot."
                      : "Review the notes above and raise a ticket if you need clarification."}
                </p>
              </div>
            ) : null}
          </div>

          <Button
            size="lg"
            className={cn("w-full", rejected && "bg-rose-600 hover:bg-rose-700")}
            disabled={busy}
            onClick={() => void dismiss(active.id)}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} I have read this — close
          </Button>

          {/* recent decision history */}
          {history.length > 1 ? (
            <div className="rounded-xl border p-3">
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                <History className="h-3 w-3" /> Recent management responses
              </p>
              <div className="mt-1.5 max-h-40 space-y-1.5 overflow-y-auto thin-scroll">
                {history.slice(1, 8).map((h) => (
                  <div key={h.id} className="flex items-start gap-2 rounded-lg bg-slate-50 p-2">
                    <span
                      className={cn(
                        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-white",
                        h.status === "REJECTED" ? "bg-rose-500" : "bg-emerald-500",
                      )}
                    >
                      {h.status === "REJECTED" ? <XCircle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-semibold">{h.title}</p>
                      {h.notes ? <p className="truncate text-[10px] text-muted-foreground">{h.notes}</p> : null}
                      <p className="text-[9px] text-muted-foreground">{timeAgoShort(h.createdAt)}</p>
                    </div>
                  </div>
                ))}
              </div>
              {pending.length > 1 ? (
                <Button size="sm" variant="outline" className="mt-2 w-full" disabled={busy} onClick={() => void dismiss()}>
                  Mark all {pending.length} as read
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function timeAgoShort(date: string) {
  const diff = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
