"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, RefreshCcw, TriangleAlert, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, Input, Label, NativeSelect, SectionCard, Stat, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/dialog";
import { OpenLeadButton } from "@/components/shared/lead-peek";
import { cn, dateTime, timeAgo } from "@/lib/utils";

type Report = {
  id: number;
  leadId: number;
  businessName: string;
  leadCode: string | null;
  leadPhone: string;
  leadStatus: string;
  reporterId: number;
  reporterName: string;
  reporterRole: string;
  category: string;
  details: string;
  proofUrl: string | null;
  status: string;
  resolution: string | null;
  actionTaken: string | null;
  createdAt: string;
  decidedAt: string | null;
};

const CATEGORY_LABEL: Record<string, string> = {
  WRONG_NUMBER: "Wrong / Invalid Number",
  DUPLICATE: "Duplicate Lead",
  CLOSED_BUSINESS: "Business Permanently Closed",
  WRONG_DATA: "Incorrect Business Data",
  DO_NOT_CALL: "Asked Not To Be Called",
  OTHER: "Other Issue",
};

const ACTIONS = [
  { value: "NONE", label: "No lead change" },
  { value: "LEAD_UNASSIGNED", label: "Unassign lead → back to pool" },
  { value: "MARKED_DO_NOT_CALL", label: "Mark as Do-Not-Call" },
];

export function LeadErrorsPanel() {
  const [rows, setRows] = useState<Report[]>([]);
  const [counts, setCounts] = useState({ pending: 0, resolved: 0, rejected: 0, total: 0 });
  const [scope, setScope] = useState("PENDING");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<Report | null>(null);
  const [resolution, setResolution] = useState("");
  const [leadAction, setLeadAction] = useState("NONE");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/lead-errors?scope=${scope}`);
    if (res.ok) {
      const json = (await res.json()) as { rows: Report[]; counts: typeof counts };
      setRows(json.rows ?? []);
      setCounts(json.counts);
    }
    setLoading(false);
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(id: number, action: "RESOLVE" | "REJECT") {
    setBusy(true);
    const res = await fetch("/api/lead-errors", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, resolution: resolution || undefined, leadAction }),
    });
    const json = (await res.json()) as { error?: string };
    if (res.ok) {
      toast.success(action === "RESOLVE" ? "Report resolved" : "Report rejected");
      setActive(null);
      setResolution("");
      setLeadAction("NONE");
      await load();
    } else toast.error(json.error ?? "Action failed");
    setBusy(false);
  }

  const tone = (s: string) => (s === "RESOLVED" ? "success" : s === "REJECTED" ? "danger" : "warn");

  return (
    <div className="space-y-3 p-3 sm:p-4 lg:p-6">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Pending review" value={counts.pending} tone="warn" />
        <Stat label="Resolved" value={counts.resolved} tone="success" />
        <Stat label="Rejected" value={counts.rejected} tone="danger" />
        <Stat label="Total reports" value={counts.total} />
      </div>

      <SectionCard
        title="Lead Errors / Corrections Queue"
        icon={<TriangleAlert className="h-3.5 w-3.5" />}
        action={
          <Button size="sm" variant="outline" onClick={() => void load()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          </Button>
        }
      >
        <div className="mb-2 flex gap-1.5 overflow-x-auto no-scrollbar">
          {["PENDING", "RESOLVED", "REJECTED", "ALL"].map((sc) => (
            <button
              key={sc}
              onClick={() => setScope(sc)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-semibold",
                scope === sc ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600",
              )}
            >
              {sc === "ALL" ? "All" : sc.charAt(0) + sc.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        {rows.length === 0 && !loading ? (
          <EmptyState title="No error reports" hint="Agent reports land here when they flag bad lead data." icon="🛠️" />
        ) : null}

        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="rounded-xl border bg-white p-3 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-bold">
                    {r.businessName}
                    <span className="font-mono text-[11px] font-normal text-blue-700">{r.leadCode ?? `#${r.leadId}`}</span>
                    <Badge variant="outline">{CATEGORY_LABEL[r.category] ?? r.category}</Badge>
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Reported by {r.reporterName} ({r.reporterRole}) · {timeAgo(r.createdAt)} · lead stage {r.leadStatus.replace("_", " ")}
                  </p>
                  <p className="mt-1 rounded-lg bg-slate-50 p-2 text-xs">{r.details}</p>
                  {r.proofUrl ? (
                    <a href={r.proofUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[11px] text-blue-600 underline">
                      View attached proof
                    </a>
                  ) : null}
                  {r.resolution ? (
                    <p className="mt-1.5 rounded-lg bg-emerald-50 p-2 text-[11px] text-emerald-800">
                      <strong>Resolution:</strong> {r.resolution}
                      {r.actionTaken && r.actionTaken !== "NONE" ? ` · action: ${r.actionTaken.replace(/_/g, " ").toLowerCase()}` : ""}
                    </p>
                  ) : null}
                </div>
                <Badge variant={tone(r.status)}>{r.status}</Badge>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                <OpenLeadButton leadId={r.leadId} leadCode={r.leadCode} isStaff={true} label="Open Lead" />
              </div>

              {r.status === "PENDING" ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setActive(r)}>
                    Review
                  </Button>
                  <Button size="sm" variant="success" disabled={busy} onClick={() => void decide(r.id, "RESOLVE")}>
                    <CheckCircle2 className="h-4 w-4" /> Resolve
                  </Button>
                  <Button size="sm" variant="destructive" disabled={busy} onClick={() => void decide(r.id, "REJECT")}>
                    <XCircle className="h-4 w-4" /> Reject
                  </Button>
                </div>
              ) : (
                <p className="mt-2 text-[10px] text-muted-foreground">
                  {r.actionTaken && r.actionTaken !== "NONE" ? "Lead updated · " : ""}reviewed {r.decidedAt ? dateTime(r.decidedAt) : ""}
                </p>
              )}
            </div>
          ))}
        </div>
      </SectionCard>

      <Sheet
        open={Boolean(active)}
        onOpenChange={(v) => !v && setActive(null)}
        title={active ? `Review · ${active.businessName}` : "Review"}
        description="Optionally take corrective action on the lead itself."
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setActive(null)}>
              Close
            </Button>
            <Button variant="success" className="flex-1" disabled={busy} onClick={() => active && void decide(active.id, "RESOLVE")}>
              <CheckCircle2 className="h-4 w-4" /> Resolve
            </Button>
          </div>
        }
      >
        {active ? (
          <div className="space-y-2">
            <div className="rounded-xl border p-2.5 text-xs">
              <p className="font-bold">{active.businessName}</p>
              <p className="text-muted-foreground">
                {active.leadCode ?? `#${active.leadId}`} · {active.leadPhone} · stage {active.leadStatus.replace("_", " ")}
              </p>
              <p className="mt-1.5 rounded-lg bg-slate-50 p-2">{active.details}</p>
            </div>
            <div className="space-y-1">
              <Label>Corrective action</Label>
              <NativeSelect value={leadAction} onChange={(e) => setLeadAction(e.target.value)}>
                {ACTIONS.map((a) => (
                  <option key={a.value} value={a.value}>
                    {a.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label>Resolution note</Label>
              <Textarea
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                placeholder="Verified with the agent — number is dead. Lead unassigned and flagged."
                className="min-h-[80px]"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="destructive" className="flex-1" disabled={busy} onClick={() => void decide(active.id, "REJECT")}>
                <XCircle className="h-4 w-4" /> Reject report
              </Button>
              <Button variant="success" className="flex-1" disabled={busy} onClick={() => void decide(active.id, "RESOLVE")}>
                <CheckCircle2 className="h-4 w-4" /> Resolve
              </Button>
            </div>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
