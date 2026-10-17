"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Lock, PhoneCall, RefreshCcw, Repeat, Search, Star } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/components/app-shell";
import { LeadModal } from "@/components/agent/lead-modal";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/dialog";
import { Badge, EmptyState, Input, Label, NativeSelect, SectionCard, Stat, Textarea } from "@/components/ui/field";
import { AGENT_FILTERS } from "@/lib/rbac";
import { cn, hms, num, timeAgo } from "@/lib/utils";
import { LEAD_FIELDS } from "@/lib/fields";

type LeadRow = Record<string, unknown> & {
  id: number;
  nicheColor: string;
  accessUnlocked: boolean;
  callCount: number;
  lastTouchedAt: string | null;
  assignedAt: string | null;
  canDial?: boolean;
};

function str(v: unknown): string | null {
  return v === null || v === undefined || v === "" ? null : String(v);
}

/** Secondary fields the admin enabled for agents, surfaced as chips. */
function extraChips(lead: Record<string, unknown>): string[] {
  const chips: string[] = [];
  if (!lead.service_status__hidden && lead.service_status) chips.push(`SVC: ${String(lead.service_status)}`);
  if (!lead.website_status__hidden && lead.website_status) chips.push(`WEB: ${String(lead.website_status)}`);
  if (!lead.opens_at__hidden && lead.opens_at) chips.push(`🕒 ${String(lead.opens_at)}`);
  if (!lead.category_name__hidden && lead.category_name) chips.push(String(lead.category_name));
  return chips;
}

function statusTone(status: string) {
  switch (status) {
    case "IN_PROGRESS":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "CALLBACK":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "PAYMENT_APPROVAL":
      return "border-violet-200 bg-violet-50 text-violet-700";
    default:
      return "border-rose-200 bg-rose-50 text-rose-700";
  }
}

export function AgentConsole() {
  const { nicheId, user, niches } = useApp();
  const [tab, setTab] = useState<string>("IN_PROGRESS");
  const [page, setPage] = useState(1);
  const [q, setQ] = useState("");
  const [data, setData] = useState<{
    rows: LeadRow[];
    total: number;
    totalPages: number;
    tabCounts: Record<string, number>;
    callsLogged: number;
  } | null>(null);
  const [openLead, setOpenLead] = useState<number | null>(null);
  const [todaySeconds, setTodaySeconds] = useState(0);
  const [requestOpen, setRequestOpen] = useState(false);
  const [reqQty, setReqQty] = useState(10);
  const [reqNote, setReqNote] = useState("");
  const [reqNiche, setReqNiche] = useState(0);
  const [reqBusy, setReqBusy] = useState(false);
  const [replaceLeadId, setReplaceLeadId] = useState(0);
  const [replaceReason, setReplaceReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [stageCounts, setStageCounts] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ tab, page: String(page), pageSize: "20" });
    if (nicheId) params.set("nicheId", String(nicheId));
    if (q.trim()) params.set("q", q.trim());
    const res = await fetch(`/api/agent/leads?${params.toString()}`);
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, [tab, page, nicheId, q]);

  // Dedicated counter fetch so the stage pills always show exact totals.
  useEffect(() => {
    const params = new URLSearchParams({ mine: "true" });
    if (nicheId) params.set("nicheId", String(nicheId));
    if (q.trim()) params.set("q", q.trim());
    void fetch(`/api/pipeline/counts?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { counters?: Record<string, number> } | null) => j && setStageCounts(j.counters ?? {}))
      .catch(() => undefined);
  }, [nicheId, q, data]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [tab, nicheId, q]);

  // Active-today stat mirrors the server snapshot and ticks ONLY while the tab
  // is visible, matching the Page Visibility tracker that syncs every 60s.
  useEffect(() => {
    let alive = true;
    const load = () => {
      void fetch("/api/agent/track-time")
        .then((r) => (r.ok ? r.json() : null))
        .then((j: { today?: { activeSeconds?: number } } | null) => {
          if (alive && j?.today) setTodaySeconds(j.today.activeSeconds ?? 0);
        })
        .catch(() => undefined);
    };
    void load();
    const loadTimer = setInterval(load, 60000);

    const tick = setInterval(() => {
      if (document.visibilityState === "visible") setTodaySeconds((s) => s + 1);
    }, 1000);

    return () => {
      alive = false;
      clearInterval(loadTimer);
      clearInterval(tick);
    };
  }, []);

  async function sendReplace() {
    if (replaceLeadId === 0) {
      toast.error("Select the lead you want replaced");
      return;
    }
    if (replaceReason.trim().length < 10) {
      toast.error("Reason must be at least 10 characters");
      return;
    }
    setReqBusy(true);
    const res = await fetch("/api/leads/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "REPLACE_LEAD", leadId: replaceLeadId, reason: replaceReason.trim() }),
    });
    const json = (await res.json()) as { error?: string };
    if (res.ok) {
      toast.success("Replacement request sent to Admin/HR/Manager");
      setRequestOpen(false);
      setReplaceReason("");
      setReplaceLeadId(0);
    } else toast.error(json.error ?? "Could not send request");
    setReqBusy(false);
  }

  async function sendRequest() {
    setReqBusy(true);
    const res = await fetch("/api/agent/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity: reqQty, nicheId: reqNiche || undefined, note: reqNote }),
    });
    if (res.ok) {
      toast.success("Request sent to Admin/HR");
      setRequestOpen(false);
      setReqNote("");
    } else toast.error("Could not send request");
    setReqBusy(false);
  }

  const rows = data?.rows ?? [];
  const counts = data?.tabCounts ?? {};
  const totalAssigned = Object.values(counts).reduce((a, b) => a + b, 0);
  const activeTab = AGENT_FILTERS.find((f) => f.key === tab);

  return (
    <div className="space-y-3 p-3 sm:p-4 lg:p-6">
      {/* exact pipeline stage counters */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <Stat label="All" value={num(stageCounts.ALL ?? 0)} hint="my queue" />
        <Stat label="In Process" value={num(stageCounts.IN_PROGRESS ?? 0)} tone="info" />
        <Stat label="Call Back" value={num(stageCounts.CALLBACK ?? 0)} tone="warn" />
        <Stat label="No Response" value={num(stageCounts.NO_RESPONSE ?? 0)} />
        <Stat label="Payment Appr." value={num(stageCounts.PAYMENT_APPROVAL ?? 0)} tone="default" />
        <Stat label="Reject/No Int." value={num(stageCounts.REJECTED ?? 0)} tone="danger" />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Calls logged" value={num(data?.callsLogged ?? 0)} hint="all time" tone="info" />
        <Stat label="Active today" value={hms(todaySeconds)} hint="visible tab only" tone="success" />
        <Stat label="Total assigned" value={num(totalAssigned)} hint="across stages" />
      </div>

      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-muted-foreground sm:left-2.5 sm:top-2.5 sm:h-4 sm:w-4" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search business, city, phone"
            className="pl-11 sm:pl-8"
            inputMode="search"
          />
        </div>
        <Button variant="outline" size="icon" className="h-11 w-11 shrink-0 sm:h-10 sm:w-10" onClick={() => void load()} aria-label="Refresh">
          <RefreshCcw className="h-4 w-4" />
        </Button>
      </div>

      <div className="no-scrollbar -mx-3 flex gap-1.5 overflow-x-auto px-3 sm:mx-0 sm:px-0">
        {AGENT_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setTab(f.key)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold",
              tab === f.key ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600",
            )}
          >
            <span className={cn("h-2 w-2 shrink-0 rounded-full", f.dot)} />
            <span className="whitespace-nowrap">{f.label}</span>
            <span className="rounded-full bg-slate-100 px-1.5 text-[10px] font-bold text-slate-600">{counts[f.key] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between px-0.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {activeTab?.label} · {num(data?.total ?? 0)} leads
        </p>
        {data && data.totalPages > 1 ? (
          <p className="text-[11px] text-muted-foreground">
            Page {page}/{data.totalPages}
          </p>
        ) : null}
      </div>

      <div className="space-y-2">
        {loading && rows.length === 0 ? <p className="py-8 text-center text-xs text-muted-foreground">Loading leads…</p> : null}
        {!loading && rows.length === 0 ? (
          totalAssigned === 0 ? (
            <EmptyState
              title="No leads found"
              hint="You have no leads assigned yet. Ask Admin/HR for an allocation, or use Request Replace Lead once leads arrive."
              icon="📋"
            />
          ) : (
            <EmptyState
              title="No leads in this bucket"
              hint="Nothing in this status right now. Try another tab above."
              icon="📋"
            />
          )
        ) : null}

        {rows.map((lead) => (
          <button
            key={lead.id}
            onClick={() => setOpenLead(lead.id)}
            className="block w-full rounded-xl border bg-white p-3 text-left shadow-sm transition active:scale-[0.99]"
          >
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 h-9 w-1.5 shrink-0 rounded-full" style={{ background: lead.nicheColor }} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-bold">{str(lead.business_name) ?? `Lead #${lead.id}`}</p>
                  {lead.phone__masked ? <Lock className="h-3.5 w-3.5 shrink-0 text-amber-500" /> : null}
                </div>
                <p className="truncate text-[11px] text-muted-foreground">
                  {str(lead.lead_code) ?? `#${lead.id}`} · {str(lead.city_keyword) ?? "—"}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Badge className={cn("border", statusTone(str(lead.status) ?? ""))}>{(str(lead.status) ?? "").replace("_", " ")}</Badge>
                  {!lead.rating__hidden && lead.rating ? (
                    <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                      {Number(lead.rating).toFixed(1)}
                    </span>
                  ) : null}
                  {!lead.reviews_count__hidden ? (
                    <span className="text-[10px] text-muted-foreground">
                      {str(lead.reviews_count) ?? "••"} vs {str(lead.competitor_reviews) ?? "••"}
                    </span>
                  ) : null}
                  {lead.call_status ? (
                    <span className="text-[10px] text-muted-foreground">· {String(lead.call_status)}</span>
                  ) : null}
                  <span className="text-[10px] text-muted-foreground">· {lead.callCount} calls</span>
                </div>
                {/* extra admin-enabled fields rendered inline */}
                {extraChips(lead).length ? (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {extraChips(lead).map((chip) => (
                      <span key={chip} className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium text-slate-600">
                        {chip}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-full",
                    lead.canDial === false ? "bg-slate-100 text-slate-400" : "bg-blue-50 text-blue-600",
                  )}
                >
                  <PhoneCall className="h-4 w-4" />
                </span>
                <span className="text-[10px] text-muted-foreground">{timeAgo(lead.lastTouchedAt ?? lead.assignedAt)}</span>
              </div>
            </div>
          </button>
        ))}
      </div>

      {data && data.totalPages > 1 ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border bg-white p-2">
          <Button variant="outline" size="sm" className="flex-1 sm:flex-none" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <ChevronLeft className="h-4 w-4" /> Prev
          </Button>
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Page {page} / {data.totalPages} · {num(data.total)} leads
          </span>
          <span className="text-xs text-muted-foreground sm:hidden">
            {page}/{data.totalPages}
          </span>
          <Button variant="outline" size="sm" className="flex-1 sm:flex-none" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      ) : null}

      <Button variant="secondary" className="w-full" size="lg" onClick={() => setRequestOpen(true)}>
        <Repeat className="h-4 w-4" /> Request Replace Lead
      </Button>

      <p className="pb-2 text-center text-[10px] text-muted-foreground">
        Signed in as {user.name} · delete permissions are disabled for telecalling agents by policy.
      </p>

      {openLead ? <LeadModal leadId={openLead} onClose={() => setOpenLead(null)} onChanged={() => void load()} /> : null}

      <Sheet
        open={requestOpen}
        onOpenChange={setRequestOpen}
        title="Request Replace Lead"
        description="Pick a lead you are stuck on and give a reason — Admin/HR/Manager will approve and assign a fresh lead."
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setRequestOpen(false)}>
              Cancel
            </Button>
            <Button className="flex-1" disabled={reqBusy || reqQty < 1} onClick={() => void sendRequest()}>
              {reqBusy ? "Sending…" : "Send request"}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Lead to replace</Label>
            <NativeSelect value={replaceLeadId} onChange={(e) => setReplaceLeadId(Number(e.target.value))}>
              <option value={0}>— select an assigned lead —</option>
              {rows.map((r) => (
                <option key={r.id} value={r.id}>
                  {String(r.business_name ?? `#${r.id}`)} · {String(r.status ?? "").replace("_", " ")}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label>
              <span className="font-semibold text-rose-700">Reason for Replacement *</span>
            </Label>
            <Textarea
              value={replaceReason}
              onChange={(e) => setReplaceReason(e.target.value)}
              placeholder="Number switched off after 4 attempts across 3 days / prospect asked not to be called…"
            />
            <p className="text-[10px] text-muted-foreground">Minimum 10 characters. Goes to Admin/HR/Manager for approval.</p>
          </div>
          <Button
            className="w-full"
            size="lg"
            disabled={reqBusy || replaceLeadId === 0 || replaceReason.trim().length < 10}
            onClick={() => void sendReplace()}
          >
            {reqBusy ? "Sending…" : "Submit replacement request"}
          </Button>
          <div className="border-t pt-2">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Or request brand-new leads</p>
            <div className="grid grid-cols-2 gap-2">
              <NativeSelect value={reqNiche} onChange={(e) => setReqNiche(Number(e.target.value))}>
                <option value={0}>My niche</option>
                {niches.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </NativeSelect>
              <Input inputMode="numeric" value={reqQty} onChange={(e) => setReqQty(Number(e.target.value) || 0)} placeholder="10" />
            </div>
            <Button variant="outline" className="mt-2 w-full" disabled={reqBusy} onClick={() => void sendRequest()}>
              Request {reqQty} new leads
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

export function NicheSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const { niches } = useApp();
  return (
    <NativeSelect value={value} onChange={(e) => onChange(Number(e.target.value))}>
      <option value={0}>My default niche</option>
      {niches.map((n) => (
        <option key={n.id} value={n.id}>
          {n.name} ({num(n.total ?? 0)})
        </option>
      ))}
    </NativeSelect>
  );
}

export { SectionCard };
