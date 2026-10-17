"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Clock, GripVertical, UserX, Loader2, RefreshCcw, Search, Timer, TrendingUp, Users, ShieldCheck, Trophy } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Badge, Input, NativeSelect, Stat } from "@/components/ui/field";
import { STATUS_META } from "@/lib/rbac";
import { AssignedToBadge } from "@/components/shared/assignment-badge";
import { BulkActionsBar } from "@/components/staff/bulk-actions-bar";
import { LeadPeek, OpenLeadButton } from "@/components/shared/lead-peek";
import { cn, inr, num, timeAgo } from "@/lib/utils";
import { StageCounters } from "@/components/staff/stage-counters";

type Agent = { id: string; name: string; role: string; isOnline: boolean; lastSeenAt: string | null };
type Card = Record<string, unknown> & {
  id: number;
  assignedAgentId: number | null;
  accessUnlocked: boolean;
  callCount: number;
  dealAmount: string | null;
  commissionAmount: string | null;
  assignedAt: string | null;
  lastTouchedAt: string | null;
  updatedAt: string;
  agent: { id: string; name: string; role: string; isOnline: boolean; lastSeenAt: string | null } | null;
};
type Column = { key: string; label: string; staffOnly: boolean; virtual: boolean; count: number; cards: Card[] };

const STAFF_ONLY = ["UNASSIGNED", "CLOSED"];

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function avatarColor(id: string | number) {
  const tones = ["bg-blue-600", "bg-emerald-600", "bg-violet-600", "bg-orange-600", "bg-rose-600", "bg-teal-600"];
  const text = String(id ?? "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return tones[hash % tones.length] ?? "bg-blue-600";
}

export function PipelineBoard() {
  const { nicheId, setNicheId, niches } = useApp();
  const [columns, setColumns] = useState<Column[]>([]);
  const [roster, setRoster] = useState<Agent[]>([]);
  const [totals, setTotals] = useState<{ total: number; unassigned: number; won: number; value: number } | null>(null);
  const [agentId, setAgentId] = useState("");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [compact, setCompact] = useState(false);
  const [peekId, setPeekId] = useState<number | null>(null);
  // Dual pipeline: A = assigned (7 stages), B = unassigned (3 stages, mgmt only)
  const [pipeline, setPipeline] = useState<"assigned" | "unassigned" | "backcheck" | "deals">("assigned");
  // bulk selection (multi-lead actions work on the Kanban too)
  const [selected, setSelected] = useState<number[]>([]);
  const [busyBulk, setBusyBulk] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const boardRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ pipeline });
    if (nicheId) params.set("nicheId", String(nicheId));
    if (agentId) params.set("agentId", String(agentId));
    if (q.trim()) params.set("q", q.trim());
    const res = await fetch(`/api/pipeline/board?${params.toString()}`);
    if (res.ok) {
      const json = (await res.json()) as { columns: Column[]; roster: Agent[]; totals: typeof totals };
      setColumns(json.columns);
      setRoster(json.roster);
      setTotals(json.totals);
    }
    setLoading(false);
  }, [nicheId, agentId, q, pipeline]);

  useEffect(() => {
    void load();
  }, [load]);

  /* auto-sync: silent re-fetch on the shell's 60s pulse */
  useEffect(() => {
    const onSync = () => {
      setSyncing(true);
      void load().finally(() => setSyncing(false));
    };
    window.addEventListener("ags-autosync", onSync);
    return () => window.removeEventListener("ags-autosync", onSync);
  }, [load]);

  const agents = useMemo(() => roster.filter((r) => r.role === "AGENT"), [roster]);

  async function move(leadId: number, toStage: string) {
    setMoving(true);
    const res = await fetch("/api/pipeline/board", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId, toStage }),
    });
    if (res.ok) {
      toast.success(`Moved to ${STATUS_META[toStage]?.label ?? toStage}`);
      await load();
    } else {
      const json = (await res.json()) as { error?: string };
      toast.error(json.error ?? "Move failed");
    }
    setMoving(false);
  }

  /** Opens the full-screen lead modal for any card, anywhere on the board. */
  const openDetail = (id: number) => setPeekId(id);

  const toggleSelect = (id: number) =>
    setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));

  async function bulkRun(op: string, extra: Record<string, unknown> = {}) {
    setBusyBulk(true);
    try {
      const res = await fetch(`/api/leads/bulk?op=${op}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selected, ...extra }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) toast.error(json.error ?? "Bulk action failed");
      setSelected([]);
      await load();
    } finally {
      setBusyBulk(false);
    }
  }

  function onDrop(stage: string) {
    if (dragId === null) return;
    const id = dragId;
    setDragId(null);
    setOverStage(null);
    void move(id, stage);
  }

  return (
    <div className="space-y-3 p-3 sm:p-4 lg:p-6">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Leads on board" value={num(totals?.total ?? 0)} hint="all stages" />
        <Stat label="Pool leads" value={num(totals?.unassigned ?? 0)} tone="warn" hint="unassigned pool" />
        <Stat label="Closed Won" value={num(totals?.won ?? 0)} tone="success" hint="staff-only stage" />
        <Stat label="Won value" value={inr(totals?.value ?? 0)} tone="info" />
      </div>

      <div className="space-y-2 rounded-xl border bg-white p-2 sm:p-3">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-muted-foreground sm:left-2.5 sm:top-2.5 sm:h-4 sm:w-4" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search business, phone or lead code" className="pl-11 sm:pl-8" inputMode="search" />
          </div>
          <Button variant="outline" size="icon" className="h-11 w-11 shrink-0 sm:h-10 sm:w-10" onClick={() => void load()} aria-label="Refresh board">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 lg:flex lg:flex-wrap">
          <NativeSelect value={agentId} onChange={(e) => setAgentId(e.target.value)} className="lg:w-auto lg:min-w-[170px]">
            <option value={0}>All agents</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={nicheId} onChange={(e) => setNicheId(Number(e.target.value))} className="lg:w-auto lg:min-w-[170px]">
            <option value={0}>All niches</option>
            {niches.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name} ({num(n.total ?? 0)})
              </option>
            ))}
          </NativeSelect>
          <Button variant="outline" size="sm" className="col-span-2 lg:col-span-1" onClick={() => setCompact((c) => !c)}>
            {compact ? "Comfort view" : "Compact view"}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          {pipeline === "assigned"
            ? "Assigned Leads Pipeline — every lead has an agent. “New” holds leads assigned today; Closed Won is management-only."
            : pipeline === "unassigned"
              ? "Pool Leads Pipeline — nobody owns these leads. Auto-allocation draws ONLY from this pool, bounded by each agent's Per Day Lead Limit."
              : pipeline === "backcheck"
                ? "Backed Check Pipeline — payment-proof leads queued for backend review. Drag to Approve (→ Deals Won) or Send Back (→ rework)."
                : "Deals Won Pipeline — every Closed Won lead lands here automatically with its deal value. Drag to Lost to reverse."}
        </p>
      </div>

      {/* ---------- four-pipeline structure ---------- */}
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        {([
          { key: "unassigned", label: "Pool Leads Pipeline", sub: "Auto-alloc source · per-day limits", icon: UserX },
          { key: "assigned", label: "Assigned Leads Pipeline", sub: "5 working stages · owner on every card", icon: Users },
          { key: "backcheck", label: "Backed Check Pipeline", sub: "Backend review of payment proofs", icon: ShieldCheck },
          { key: "deals", label: "Deals Won Pipeline", sub: "Closed Won auto-routes here", icon: Trophy },
        ] as const).map((tab) => {
          const on = pipeline === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setPipeline(tab.key)}
              className={cn(
                "flex items-center gap-2 rounded-xl border p-2.5 text-left transition sm:p-3",
                on ? "border-blue-500 bg-blue-50 shadow-sm" : "border-slate-200 bg-white hover:bg-slate-50",
              )}
            >
              <span
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                  on ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500",
                )}
              >
                <tab.icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className={cn("block truncate text-xs font-bold sm:text-sm", on ? "text-blue-700" : "text-slate-700")}>
                  {tab.label}
                </span>
                <span className="block truncate text-[10px] text-muted-foreground">{tab.sub}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* exact stage counters — respect the active pipeline/niche/agent filter */}
      {(pipeline === "assigned" || pipeline === "unassigned") ? (
        <StageCounters scope="staff" nicheId={nicheId} agentId={agentId} q={q} pipeline={pipeline} />
      ) : null}

      {/* bulk actions bar for Kanban selections */}
      <BulkActionsBar
        selectedIds={selected}
        agents={agents}
        onClear={() => setSelected([])}
        onDone={() => {
          setSelected([]);
          void load();
        }}
        onAssign={async (agentId) => void (await bulkRun("assign", { agentId }))}
        onStatus={async (status) => void (await bulkRun("status", { status }))}
        onPool={async () => void (await bulkRun("pool"))}
        onFields={async (fields) => void (await bulkRun("fields", { fields }))}
      />
      {syncing && !busyBulk ? (
        <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <RefreshCcw className="h-3 w-3 animate-spin" /> auto-syncing board…
        </p>
      ) : null}

      {busyBulk ? (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Applying bulk action to {selected.length} lead(s)…
        </p>
      ) : null}

      {moving ? (
        <p className="flex items-center gap-1.5 text-xs text-blue-700">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Updating pipeline…
        </p>
      ) : null}

      {/* board */}
      <div ref={boardRef} className="flex gap-2 overflow-x-auto pb-3 thin-scroll sm:gap-3">
        {columns.map((col) => (
          <div
            key={col.key}
            onDragOver={(e) => {
              e.preventDefault();
              setOverStage(col.key);
            }}
            onDragLeave={() => setOverStage((s) => (s === col.key ? null : s))}
            onDrop={() => onDrop(col.key)}
            className={cn(
              "flex w-[78vw] shrink-0 flex-col rounded-xl border p-2 transition sm:w-64",
              STATUS_META[col.key]?.kanban ?? "bg-slate-50 border-slate-300",
              overStage === col.key && "ring-2 ring-blue-400 ring-offset-1",
            )}
          >
            <div className="mb-2 flex items-center justify-between gap-1 px-1">
              <p className="flex min-w-0 items-center gap-1.5 text-xs font-bold">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", col.staffOnly ? "bg-zinc-500" : "bg-blue-500")} />
                <span className="truncate">{col.label}</span>
                {col.staffOnly ? <Badge variant="muted">staff</Badge> : null}
              </p>
              <Badge variant="muted" className="shrink-0">
                {num(col.count)}
              </Badge>
            </div>

            <div className="max-h-[58vh] min-h-[80px] space-y-2 overflow-y-auto thin-scroll">
              {col.cards.length === 0 ? (
                <p className="rounded-lg border border-dashed p-3 text-center text-[10px] text-muted-foreground">
                {pipeline === "unassigned" && col.key !== "UNASSIGNED"
                  ? "Drop here to auto-unassign (status kept)"
                  : "Drop cards here"}
              </p>
              ) : null}

              {col.cards.map((card) => {
                const stage = String(card.status ?? (col.key === "UNASSIGNED" ? "NEW" : col.key));
                const agent = card.agent;
                return (
                  <div
                    key={card.id}
                    draggable
                    onDragStart={() => setDragId(card.id)}
                    onDragEnd={() => setDragId(null)}
                    className={cn(
                      "cursor-grab rounded-lg border bg-white p-2 shadow-sm transition active:cursor-grabbing",
                      dragId === card.id && "opacity-50",
                      compact ? "space-y-1" : "space-y-1.5",
                    )}
                  >
                    <div className="flex items-start gap-1.5">
                      <input
                        type="checkbox"
                        checked={selected.includes(card.id)}
                        onChange={() => toggleSelect(card.id)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Select lead ${card.id}`}
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer"
                      />
                      <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300" />
                      <div className="min-w-0 flex-1">
                        <button
                          className="block w-full truncate text-left text-xs font-bold text-blue-700 hover:underline"
                          onClick={() => void openDetail(card.id)}
                          title="Open full lead details"
                        >
                          {String(card.business_name ?? `Lead #${card.id}`)}
                        </button>
                        <p className="truncate text-[10px] text-muted-foreground">
                          {String(card.lead_code ?? `#${card.id}`)} · {String(card.city_keyword ?? "—")}
                        </p>
                      </div>
                    </div>

                    {!compact ? (
                      <div className="flex flex-wrap items-center gap-1 pl-5">
                        {card.rating ? (
                          <span className="rounded bg-amber-50 px-1 py-0.5 text-[9px] font-semibold text-amber-700">
                            ★ {Number(card.rating).toFixed(1)}
                          </span>
                        ) : null}
                        {!card.reviews_count__hidden ? (
                          <span className="rounded bg-slate-100 px-1 py-0.5 text-[9px] text-slate-600">
                            {String(card.reviews_count ?? "••")} vs {String(card.competitor_reviews ?? "••")}
                          </span>
                        ) : null}
                        {card.call_status ? (
                          <span className="rounded bg-slate-100 px-1 py-0.5 text-[9px] text-slate-600">{String(card.call_status)}</span>
                        ) : null}
                        {card.dealAmount ? (
                          <span className="rounded bg-emerald-50 px-1 py-0.5 text-[9px] font-semibold text-emerald-700">{inr(card.dealAmount)}</span>
                        ) : null}
                      </div>
                    ) : null}

                    {/* decoupled: Pipeline Status */}
                    <div className="pl-5">
                      <p className="mb-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">Status:</p>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                          STATUS_META[stage]?.className ?? "border-slate-200 bg-slate-100 text-slate-700",
                        )}
                      >
                        {STATUS_META[stage]?.label ?? stage.replace(/_/g, " ")}
                      </span>
                    </div>

                    {/* decoupled: Assignment State (Assigned To) — independent of Status */}
                    <div className="pl-5">
                      <p className="mb-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">Assigned To:</p>
                      <AssignedToBadge agent={agent} />
                    </div>

                    {!compact ? (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-5 text-[9px] text-muted-foreground">
                        <span className="flex items-center gap-0.5">
                          <Clock className="h-2.5 w-2.5" /> assigned {timeAgo(card.assignedAt)}
                        </span>
                        <span className="flex items-center gap-0.5">
                          <Timer className="h-2.5 w-2.5" /> touched {timeAgo(card.lastTouchedAt ?? card.updatedAt)}
                        </span>
                        <span>· {card.callCount} calls</span>
                      </div>
                    ) : null}

                    <div className="pl-5">
                      <OpenLeadButton leadId={card.id} leadCode={String(card.lead_code ?? card.id)} isStaff={true} label="View Lead" />
                    </div>

                    {/* quick stage move for accessibility / mobile */}
                    <select
                      value={col.key === "UNASSIGNED" ? "UNASSIGNED" : stage}
                      onChange={(e) => void move(card.id, e.target.value)}
                      className="w-full rounded border border-slate-200 bg-white px-1.5 py-1 text-[9px] font-medium text-slate-600"
                      aria-label="Move to stage"
                    >
                      {["UNASSIGNED", "NEW", "IN_PROGRESS", "CALLBACK", "NO_RESPONSE", "REJECTED", "PAYMENT_APPROVAL", "CLOSED"].map((s) => (
                        <option key={s} value={s}>
                          → {STATUS_META[s]?.label ?? s}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>

            <p className="mt-1.5 px-1 text-[9px] text-muted-foreground">
              Showing {col.cards.length} of {num(col.count)}
            </p>
          </div>
        ))}
      </div>

      <LeadPeek leadId={peekId} isStaff={true} onClose={() => setPeekId(null)} />

      <p className="flex items-center justify-center gap-1 pb-2 text-[10px] text-muted-foreground">
        <TrendingUp className="h-3 w-3" /> Assignment state and pipeline status are independent — a lead can be “No Response” and still sit in
        the Pool.
      </p>
    </div>
  );
}
