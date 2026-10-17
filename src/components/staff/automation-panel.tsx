"use client";

import { useCallback, useEffect, useState } from "react";
import { Archive, Clock, RefreshCcw, Repeat, Timer, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Stat } from "@/components/ui/field";
import { num } from "@/lib/utils";

type Preview = { unassigned: number; untouched24h: number; rejected: number; archived: number };
type Result = {
  ranAt: string;
  unassignedBackToPool: number;
  rejectedCycled: number;
  archived: number;
  staleDialingClosed: number;
  historyMasked: boolean;
  pool: Preview;
};

const STEPS = [
  {
    icon: Users,
    title: "Unassign untouched NEW leads",
    body: "Any lead still in NEW with no call activity for 24 hours is pulled back from the agent into the shared pool.",
  },
  {
    icon: Repeat,
    title: "Cycle rejected leads",
    body: "Not-interested / rejected leads rotate to the next agent (round-robin by cycle count) while previous agent names are masked.",
  },
  {
    icon: Archive,
    title: "Archive approved deals",
    body: "CLOSED leads leave the agent primary view but remain in their earnings history for commission reference.",
  },
  {
    icon: Trash2,
    title: "Close stale dialers",
    body: "Dialing logs older than 6 hours are marked ABANDONED so call duration metrics stay accurate.",
  },
];

export function AutomationPanel() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/cron/daily-cleanup");
    if (res.ok) {
      const json = (await res.json()) as { preview: Preview };
      setPreview(json.preview);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run() {
    setBusy(true);
    const res = await fetch("/api/cron/daily-cleanup", { method: "POST" });
    const json = (await res.json()) as Result & { error?: string };
    if (res.ok) {
      setResult(json);
      setLastRun(json.ranAt);
      toast.success("Cleanup cycle executed");
      await load();
    } else toast.error(json.error ?? "Run failed");
    setBusy(false);
  }

  return (
    <div className="space-y-3 p-3 lg:p-6">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Untouched 24h" value={num(preview?.untouched24h ?? 0)} tone="warn" hint="will return to pool" />
        <Stat label="Rejected / not interested" value={num(preview?.rejected ?? 0)} tone="danger" hint="ready to cycle" />
        <Stat label="Archived" value={num(preview?.archived ?? 0)} hint="out of primary view" />
        <Stat label="Pool (Unassigned)" value={num(preview?.unassigned ?? 0)} tone="info" hint="round-robin ready" />
      </div>

      <div className="rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-bold">
              <Timer className="h-4 w-4 text-blue-600" /> Daily cleanup &amp; lead cycling job
            </p>
            <p className="text-[11px] text-muted-foreground">
              Mock cron endpoint: <code>POST /api/cron/daily-cleanup</code> · designed for a midnight scheduler (Vercel Cron / pg_cron).
              {lastRun ? ` Last run ${new Date(lastRun).toLocaleString("en-IN")}.` : " Not run in this session."}
            </p>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            <Button variant="outline" size="sm" className="flex-1 sm:flex-none" onClick={() => void load()}>
              <RefreshCcw className="h-4 w-4" /> Refresh stats
            </Button>
            <Button size="sm" className="flex-1 sm:flex-none" disabled={busy} onClick={() => void run()}>
              <Clock className="h-4 w-4" /> {busy ? "Running…" : "Run cleanup now"}
            </Button>
          </div>
        </div>

        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {STEPS.map((s) => (
            <div key={s.title} className="rounded-xl border p-3">
              <p className="flex items-center gap-1.5 text-xs font-bold">
                <s.icon className="h-3.5 w-3.5 text-blue-600" /> {s.title}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">{s.body}</p>
            </div>
          ))}
        </div>
      </div>

      {result ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-bold text-emerald-800">Run complete</p>
          <ul className="mt-2 space-y-1 text-xs text-emerald-800">
            <li>• Leads returned to Pool: <strong>{num(result.unassignedBackToPool)}</strong></li>
            <li>• Rejected leads cycled to a new agent: <strong>{num(result.rejectedCycled)}</strong> (agent names masked)</li>
            <li>• Approved deals archived from primary view: <strong>{num(result.archived)}</strong></li>
            <li>• Stale dialing logs closed: <strong>{num(result.staleDialingClosed)}</strong></li>
          </ul>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge variant="success">history masked</Badge>
            <Badge variant="muted">Pool: {num(result.pool.unassigned)} lead(s)</Badge>
            <Badge variant="muted">archived total: {num(result.pool.archived)}</Badge>
          </div>
        </div>
      ) : null}
    </div>
  );
}
