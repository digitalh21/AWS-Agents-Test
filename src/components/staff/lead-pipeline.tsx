"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Kanban,
  LayoutList,
  Lock,
  RefreshCcw,
  Search,
  Shuffle,
  Upload,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { useApp } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Badge, DesktopTable, EmptyState, Input, Label, MobileList, NativeSelect, Stat } from "@/components/ui/field";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LEAD_STATUSES, STATUS_META } from "@/lib/rbac";
import { BulkActionsBar } from "@/components/staff/bulk-actions-bar";
import { LeadEditPanel, LeadHistoryTimeline, type HistoryEntry } from "@/components/staff/lead-inspect";
import { AssignedToBadge } from "@/components/shared/assignment-badge";
import { OpenLeadButton } from "@/components/shared/lead-peek";
import { AddLeadModal } from "@/components/staff/add-lead-modal";
import { cn, dateTime, inr, num, timeAgo } from "@/lib/utils";
import { StageCounters } from "@/components/staff/stage-counters";
import { FieldGrid, FieldValue, toPolicyFields } from "@/components/lead-fields";
import { LEAD_FIELDS } from "@/lib/fields";

type Lead = Record<string, unknown> & {
  id: number;
  nicheId: number;
  assignedAgentId: string | null;
  agentName?: string | null;
  accessUnlocked: boolean;
  callCount: number;
  dealAmount: string | null;
  lastTouchedAt: string | null;
  updatedAt: string;
  batchId: string | null;
};

type Payload = {
  rows: Lead[];
  fieldPolicy?: Record<string, string>;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  statusCounts: Record<string, number>;
  agents: Array<{ id: string; name: string; role: string; isOnline: boolean }>;
  globalStats: {
    total: number;
    unassigned: number;
    closed: number;
    paymentPending: number;
    revenue: number;
    totalCalls: number;
    talkSeconds: number;
  };
};

type Detail = {
  lead: Lead & { contactName: string | null; createdAt: string };
  canDial?: boolean;
  fieldPolicy?: Record<string, string>;
  agentName: string | null;
  logs: Array<{ id: number; status: string; notes: string | null; durationSeconds: number; createdAt: string; agentName: string | null; whatsappSent: boolean }>;
  trail: Array<{ id: number; action: string; detail: string | null; createdAt: string; actorId: string | null }>;
  proofs: Array<{ id: number; url: string | null; kind: string; createdAt: string }>;
  history?: HistoryEntry[];
};

function str(v: unknown): string | null {
  return v === null || v === undefined || v === "" ? null : String(v);
}

/** Which of the 14 governed fields are visible for this viewer. */
function visibleFields(policy: Record<string, string> | undefined) {
  return LEAD_FIELDS.filter((f) => policy?.[f.key] !== "HIDDEN");
}

export function LeadPipeline() {
  const { nicheId, setNicheId, user, niches } = useApp();
  const [data, setData] = useState<Payload | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("ALL");
  const [agentId, setAgentId] = useState("");
  const [q, setQ] = useState("");
  const [view, setView] = useState<"table" | "kanban">("table");
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [genCount, setGenCount] = useState(10000);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [autoAssign, setAutoAssign] = useState(true);
  // multi-select for bulk actions (management only)
  const [selected, setSelected] = useState<number[]>([]);

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: "500", view });
    if (nicheId) params.set("nicheId", String(nicheId));
    if (status !== "ALL") params.set("status", status);
    if (agentId) params.set("agentId", String(agentId));
    if (q.trim()) params.set("q", q.trim());
    const res = await fetch(`/api/leads?${params.toString()}`);
    if (res.ok) setData(await res.json());
  }, [page, nicheId, status, agentId, q, view]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPage(1);
    setSelected([]);
  }, [nicheId, status, agentId, q]);

  async function bulkRun(op: string, extra: Record<string, unknown> = {}) {
    const res = await fetch(`/api/leads/bulk?op=${op}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: selected, ...extra }),
    });
    if (op === "export") {
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `leads-export-${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
      return;
    }
    if (!res.ok) {
      const j = (await res.json()) as { error?: string };
      throw new Error(j.error ?? "Bulk action failed");
    }
    await load();
  }

  async function patchLead(id: number, body: Record<string, unknown>) {
    setBusy(true);
    const res = await fetch(`/api/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const json = (await res.json()) as { error?: string };
      toast.error(json.error ?? "Update failed");
    } else {
      toast.success("Lead updated");
      await load();
      if (detail?.lead.id === id) await openDetail(id);
    }
    setBusy(false);
  }

  async function openDetail(id: number) {
    const res = await fetch(`/api/leads/${id}`);
    if (res.ok) setDetail(await res.json());
  }

  async function runAutoAssign() {
    setBusy(true);
    const res = await fetch("/api/leads/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 500, nicheId: nicheId || undefined }),
    });
    const json = (await res.json()) as { assigned?: number; remainingInPool?: number; error?: string };
    if (res.ok) toast.success(`Round-robin assigned ${json.assigned} leads · ${json.remainingInPool} left in pool`);
    else toast.error(json.error ?? "Failed");
    await load();
    setBusy(false);
  }

  async function uploadCsv() {
    if (!csvFile) return;
    setBusy(true);
    const form = new FormData();
    form.append("file", csvFile);
    form.append("mode", "csv");
    form.append("autoAssign", String(autoAssign));
    if (nicheId) form.append("nicheId", String(nicheId));
    const res = await fetch("/api/leads/bulk", { method: "POST", body: form });
    const json = (await res.json()) as { inserted?: number; skipped?: number; assigned?: number; error?: string };
    if (res.ok) {
      toast.success(`Imported ${json.inserted} leads (${json.skipped} skipped, ${json.assigned} auto-assigned)`);
      setUploadOpen(false);
      setCsvFile(null);
      await load();
    } else toast.error(json.error ?? "Import failed");
    setBusy(false);
  }

  async function generate() {
    setBusy(true);
    const res = await fetch("/api/leads/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "generate", count: genCount }),
    });
    const json = (await res.json()) as { inserted?: number; totalLeads?: number; error?: string };
    if (res.ok) toast.success(`Generated ${num(json.inserted)} leads · dataset now ${num(json.totalLeads)}`);
    else toast.error(json.error ?? "Generation failed");
    await load();
    setBusy(false);
  }

  const stats = data?.globalStats;
  const rows = data?.rows ?? [];

  const allSelected = rows.length > 0 && selected.length === rows.length;
  const toggleAll = () => setSelected(allSelected ? [] : rows.map((r) => r.id));
  const toggleOne = (id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const statusCounts = data?.statusCounts ?? {};
  const agents = data?.agents ?? [];

  /** Dynamic column set derived from the admin field-visibility matrix. */
  const policyMap = data?.fieldPolicy ?? {};
  const cols = visibleFields(policyMap).map((f) => ({
    key: f.key,
    label: f.short,
    field: (lead: Lead) =>
      toPolicyFields(lead as Record<string, unknown>, { [f.key]: f.label }, policyMap, {
        gmap_link: "link",
        website_url: "link",
        phone: "phone",
        phone_normalized: "phone",
      }).find((x) => x.key === f.key)!,
  }));

  const agentSelect = (lead: Lead, compact = false) => (
    <NativeSelect
      value={lead.assignedAgentId ?? 0}
      onChange={(e) => void patchLead(lead.id, { action: "assign", agentId: e.target.value })}
      className={cn(compact && "h-9 w-full text-[11px] sm:h-7")}
      aria-label="Assign agent"
    >
      <option value="">Pool</option>
      {agents
        .filter((a) => a.role === "AGENT")
        .map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
    </NativeSelect>
  );

  const statusSelect = (lead: Lead, compact = false) => (
    <NativeSelect
      value={String(lead.status ?? "NEW")}
      onChange={(e) => void patchLead(lead.id, { action: "status", status: e.target.value })}
      className={cn(compact && "h-9 w-full text-[11px] sm:h-7")}
      aria-label="Lead status"
    >
      {LEAD_STATUSES.map((s) => (
        <option key={s} value={s}>
          {STATUS_META[s].label}
        </option>
      ))}
    </NativeSelect>
  );

  return (
    <div className="space-y-3 p-3 sm:p-4 lg:p-6">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-6">
        <Stat label="Leads in DB" value={num(stats?.total ?? 0)} hint={`${num(data?.totalPages ?? 0)} pages × 500`} />
        <Stat label="Pool (Unassigned)" value={num(stats?.unassigned ?? 0)} tone="warn" hint="round-robin ready" />
        <Stat label="Payment pending" value={num(stats?.paymentPending ?? 0)} tone="info" hint="need proof review" />
        <Stat label="Closed won" value={num(stats?.closed ?? 0)} tone="success" />
        <Stat label="Pipeline value" value={inr(stats?.revenue ?? 0)} />
        <Stat label="Talk time" value={`${num(Math.round((stats?.talkSeconds ?? 0) / 60))}m`} hint={`${num(stats?.totalCalls ?? 0)} calls`} />
      </div>

      {/* toolbar */}
      <StageCounters scope="staff" nicheId={nicheId} agentId={agentId} q={q} />

      <div className="space-y-2 rounded-xl border bg-white p-2 sm:p-3">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-muted-foreground sm:left-2.5 sm:top-2.5 sm:h-4 sm:w-4" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search business / phone / city"
              className="pl-11 sm:pl-8"
              inputMode="search"
            />
          </div>
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11 shrink-0 sm:h-10 sm:w-10"
            onClick={() => void load()}
            aria-label="Refresh"
          >
            <RefreshCcw className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-2 lg:flex lg:flex-wrap">
          <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)} className="lg:w-auto lg:min-w-[170px]">
            <option value="ALL">All statuses</option>
            <option value="UNASSIGNED">Pool (Unassigned)</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_META[s].label} ({num(statusCounts[s] ?? 0)})
              </option>
            ))}
          </NativeSelect>
          <NativeSelect value={agentId} onChange={(e) => setAgentId(e.target.value)} className="lg:w-auto lg:min-w-[160px]">
            <option value={0}>All agents</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
          {nicheId ? (
            <Button variant="ghost" size="sm" className="col-span-2 lg:hidden" onClick={() => useAppNicheReset()}>
              Clear niche: {niches.find((n) => n.id === nicheId)?.name}
            </Button>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-1 rounded-lg border p-0.5 lg:flex-none">
            {(["table", "kanban"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1 rounded-md px-3 py-2 text-xs font-semibold lg:flex-none",
                  view === v ? "bg-blue-600 text-white" : "text-slate-600",
                )}
              >
                {v === "table" ? <LayoutList className="h-3.5 w-3.5" /> : <Kanban className="h-3.5 w-3.5" />}
                {v === "table" ? "Table" : "Kanban"}
              </button>
            ))}
          </div>
          <Button variant="secondary" size="sm" className="flex-1 sm:flex-none" onClick={() => void runAutoAssign()} disabled={busy}>
            <Shuffle className="h-4 w-4" /> Auto-assign
          </Button>
          <Button
            variant="default"
            size="sm"
            className="flex-1 sm:flex-none border-emerald-600 bg-emerald-600 hover:bg-emerald-700"
            onClick={() => setUploadOpen(true)}
          >
            <Upload className="h-4 w-4" /> Upload CSV
          </Button>
        </div>
      </div>

      {view === "table" && user.role !== "AGENT" ? (
        <BulkActionsBar
          selectedIds={selected}
          agents={agents}
          onClear={() => setSelected([])}
          onDone={() => setSelected([])}
          onAssign={async (agentId) => bulkRun("assign", { agentId })}
          onStatus={async (status) => bulkRun("status", { status })}
          onPool={async () => bulkRun("pool")}
          onFields={async (fields) => bulkRun("fields", { fields })}
        />
      ) : null}

      {view === "table" ? (
        <>
          {/* desktop table */}
          <DesktopTable>
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="border-b bg-slate-50 text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="p-2">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Select all rows on this page"
                      className="h-4 w-4 cursor-pointer"
                    />
                  </th>
                  <th className="p-2">#</th>
                  {cols.map((c) => (
                    <th key={c.key} className="p-2">
                      {c.label}
                    </th>
                  ))}
                  <th className="p-2">Status</th>
                  <th className="p-2">Assigned To</th>
                  <th className="p-2">Access</th>
                  <th className="p-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((lead) => (
                  <tr
                    key={lead.id}
                    className={cn("border-b last:border-0", selected.includes(lead.id) ? "bg-blue-50" : "hover:bg-slate-50")}
                  >
                    <td className="p-2">
                      <input
                        type="checkbox"
                        checked={selected.includes(lead.id)}
                        onChange={() => toggleOne(lead.id)}
                        aria-label={`Select lead ${lead.id}`}
                        className="h-4 w-4 cursor-pointer"
                      />
                    </td>
                    <td className="p-2 text-muted-foreground">{lead.id}</td>
                    {cols.map((c) => (
                      <td key={c.key} className="max-w-[190px] p-2">
                        <FieldValue field={c.field(lead)} className="block" />
                      </td>
                    ))}
                    <td className="p-2">
                      {statusSelect(lead)}
                      <span className="mt-1 block text-[9px] text-muted-foreground">Status</span>
                    </td>
                    <td className="p-2">
                      <AssignedToBadge
                        agent={lead.assignedAgentId ? { id: lead.assignedAgentId, name: String(lead.agent_name ?? lead.agentName ?? "Agent") } : null}
                      />
                      <div className="mt-1">{agentSelect(lead)}</div>
                      <span className="mt-0.5 block text-[9px] text-muted-foreground">
                        {lead.assignedAgentId ? "Assigned" : "Pool"}
                      </span>
                    </td>
                    <td className="p-2">
                      <button
                        onClick={() => void patchLead(lead.id, { action: lead.accessUnlocked ? "lock" : "unlock" })}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                          lead.accessUnlocked ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700",
                        )}
                      >
                        {lead.accessUnlocked ? <Eye className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                        {lead.accessUnlocked ? "Unlocked" : "Locked"}
                      </button>
                    </td>
                    <td className="p-2 text-right">
                      <div className="mb-1 flex justify-end">
                        <OpenLeadButton leadId={lead.id} leadCode={String(lead.lead_code ?? lead.id)} isStaff={true} />
                      </div>
                      {user.role === "ADMIN" ? (
                        <button
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-rose-600 hover:bg-rose-50"
                          onClick={async () => {
                            const res = await fetch(`/api/leads/${lead.id}?confirm=DELETE`, { method: "DELETE" });
                            const json = (await res.json()) as { error?: string };
                            if (res.ok) {
                              toast.success("Lead deleted");
                              await load();
                            } else toast.error(json.error ?? "Delete restricted");
                          }}
                          title="Admin-only delete"
                        >
                          <TrashIcon />
                        </button>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">no delete</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DesktopTable>

          {/* mobile cards */}
          <MobileList>
            {rows.map((lead) => (
              <div key={lead.id} className={cn("rounded-xl border bg-white p-3 shadow-sm", selected.includes(lead.id) && "border-blue-300 bg-blue-50")}>
                <div className="flex items-start justify-between gap-2">
                  <label className="flex shrink-0 items-center gap-2 pt-0.5">
                    <input
                      type="checkbox"
                      checked={selected.includes(lead.id)}
                      onChange={() => toggleOne(lead.id)}
                      aria-label={`Select lead ${lead.id}`}
                      className="h-4 w-4 cursor-pointer"
                    />
                  </label>
                  <button className="min-w-0 flex-1 text-left" onClick={() => void openDetail(lead.id)}>
                    <p className="truncate text-sm font-bold text-blue-700">{str(lead.business_name) ?? `Lead #${lead.id}`}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {str(lead.lead_code) ?? `#${lead.id}`} · {str(lead.category_name) ?? "—"} · {str(lead.city_keyword) ?? "—"}
                    </p>
                  </button>
                  <Badge className={cn("shrink-0 border", lead.accessUnlocked ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700")}>
                    {lead.accessUnlocked ? "unlocked" : "locked"}
                  </Badge>
                </div>

                {/* dynamic field grid for this role */}
                <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px] sm:grid-cols-3">
                  {cols.slice(0, 6).map((c) => {
                    const f = c.field(lead);
                    return (
                      <div key={c.key} className="min-w-0 rounded-lg bg-slate-50 p-1.5">
                        <p className="truncate text-[9px] uppercase text-muted-foreground">{c.label}</p>
                        <p className="truncate font-medium">
                          <FieldValue field={f} />
                        </p>
                      </div>
                    );
                  })}
                </div>
                {cols.length > 6 ? (
                  <p className="mt-1 text-[9px] text-muted-foreground">+{cols.length - 6} more visible field(s) in detail view</p>
                ) : null}

                <div className="mt-2 grid grid-cols-2 gap-2">
                  {statusSelect(lead, true)}
                  {agentSelect(lead, true)}
                </div>

                {/* decoupled assignment state + status */}
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-slate-50 p-2">
                  <span className="inline-flex items-center gap-1 text-[10px]">
                    <span className="text-muted-foreground">Status:</span>
                    <Badge variant="outline">{String(lead.status ?? "").replace(/_/g, " ")}</Badge>
                  </span>
                  <span className="inline-flex items-center gap-1 text-[10px]">
                    <span className="text-muted-foreground">Assigned To:</span>
                    <AssignedToBadge
                      agent={lead.assignedAgentId ? { id: lead.assignedAgentId, name: String(lead.agent_name ?? "Agent") } : null}
                      size="xs"
                    />
                  </span>
                </div>

                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-muted-foreground">{timeAgo(lead.updatedAt)}</span>
                  <div className="flex items-center gap-1.5">
                    <Button size="xs" variant="outline" onClick={() => void patchLead(lead.id, { action: lead.accessUnlocked ? "lock" : "unlock" })}>
                      {lead.accessUnlocked ? <Lock className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      {lead.accessUnlocked ? "Lock" : "Unlock"}
                    </Button>
                    <OpenLeadButton leadId={lead.id} leadCode={String(lead.lead_code ?? lead.id)} isStaff={true} />
                    <Button size="xs" variant="ghost" onClick={() => void openDetail(lead.id)}>
                      Details
                    </Button>
                    {user.role === "ADMIN" ? (
                      <button
                        className="flex h-7 w-7 items-center justify-center rounded-md text-rose-600"
                        onClick={async () => {
                          const res = await fetch(`/api/leads/${lead.id}?confirm=DELETE`, { method: "DELETE" });
                          const json = (await res.json()) as { error?: string };
                          if (res.ok) {
                            toast.success("Lead deleted");
                            await load();
                          } else toast.error(json.error ?? "Delete restricted");
                        }}
                        aria-label="Delete lead"
                      >
                        <TrashIcon />
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </MobileList>

          {rows.length === 0 ? (
            (data?.total ?? 0) === 0 ? (
              <div className="space-y-3">
                <EmptyState
                  title="No leads found. Click 'Add Lead' to create one."
                  hint="Or import an existing list with a CSV file."
                  icon="🗂️"
                />
                <div className="flex flex-wrap justify-center gap-2">
                  <AddLeadModal onCreated={() => void load()} />
                  <Button variant="default" className="border-emerald-600 bg-emerald-600 hover:bg-emerald-700" onClick={() => setUploadOpen(true)}>
                    <Upload className="h-4 w-4" /> Upload CSV
                  </Button>
                </div>
              </div>
            ) : (
              <EmptyState title="No leads match these filters" hint="Try clearing the search or switching niche." />
            )
          ) : null}
        </>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-2 thin-scroll sm:gap-3">
          {LEAD_STATUSES.filter((s) => s !== "ARCHIVED").map((col) => {
            const items = rows.filter((r) => r.status === col).slice(0, 40);
            return (
              <div key={col} className={cn("w-[74vw] shrink-0 rounded-xl border p-2 sm:w-64", STATUS_META[col].kanban)}>
                <div className="mb-2 flex items-center justify-between px-1">
                  <p className="text-xs font-bold">{STATUS_META[col].label}</p>
                  <Badge variant="muted">{num(statusCounts[col] ?? 0)}</Badge>
                </div>
                <div className="max-h-[62vh] space-y-2 overflow-y-auto thin-scroll">
                  {items.map((lead) => (
                    <div key={lead.id} className={cn("rounded-lg border bg-white p-2 shadow-sm", selected.includes(lead.id) && "border-blue-400 bg-blue-50/60")}>
                      <div className="flex items-start gap-1.5">
                        <input
                          type="checkbox"
                          checked={selected.includes(lead.id)}
                          onChange={() => toggleOne(lead.id)}
                          aria-label={`Select lead ${lead.id}`}
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer"
                        />
                    <button
                      onClick={() => void openDetail(lead.id)}
                      className="block min-w-0 flex-1 text-left"
                    >
                      <p className="truncate text-xs font-semibold">{str(lead.business_name) ?? `Lead #${lead.id}`}</p>
                      <p className="truncate text-[10px] text-muted-foreground">
                        {str(lead.category_name) ?? "—"} · {str(lead.city_keyword) ?? "—"}
                      </p>
                      <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                        <span className="flex items-center gap-1 truncate">
                          <Users className="h-3 w-3 shrink-0" />
                          <span className="truncate">{lead.agentName ?? "pool"}</span>
                        </span>
                        <span className="shrink-0">{lead.callCount} calls</span>
                      </div>
                    </button>
                      </div>
                    </div>
                  ))}
                  {items.length === 0 ? <p className="p-2 text-[10px] text-muted-foreground">Empty column</p> : null}
                  <p className="px-1 text-[10px] text-muted-foreground">
                    First {items.length} of {num(statusCounts[col] ?? 0)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-white p-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
          <ChevronLeft className="h-4 w-4" /> Prev
        </Button>
        <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
          <span className="hidden sm:inline">
            Page {data?.page ?? page} of {num(data?.totalPages ?? 1)} · {num(data?.total ?? 0)} leads · 500/page
          </span>
          <span className="sm:hidden">
            {data?.page ?? page}/{num(data?.totalPages ?? 1)}
          </span>
          <Input
            type="number"
            value={page}
            onChange={(e) => setPage(Math.max(1, Math.min(data?.totalPages ?? 1, Number(e.target.value))))}
            className="h-9 w-20"
            aria-label="Go to page"
          />
        </div>
        <Button variant="outline" size="sm" disabled={page >= (data?.totalPages ?? 1)} onClick={() => setPage((p) => p + 1)}>
          Next <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* bulk upload + generator */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import leads from CSV</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 p-1">
            <div className="space-y-2 rounded-xl border p-3">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                <Upload className="h-3.5 w-3.5" /> CSV batch import (up to 10,000 rows per run)
              </p>
              <input type="file" accept=".csv,text/csv" onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)} className="w-full text-xs" />
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={autoAssign} onChange={(e) => setAutoAssign(e.target.checked)} />
                Auto-assign in round-robin order
              </label>
              <p className="text-[10px] text-muted-foreground">
                Columns: business_name, phone, contact_name, city, rating, reviews_count, competitor_name, competitor_reviews, email, niche
              </p>
              <Button className="w-full" disabled={!csvFile || busy} onClick={() => void uploadCsv()}>
                Process batch
              </Button>
            </div>
            <p className="rounded-lg bg-slate-50 p-2 text-[11px] text-muted-foreground">
              Rows are inserted into the live <code>leads</code> table with all 14 fields mapped. Existing demo-data generation has been removed.
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* lead detail — full screen on mobile */}
      <Dialog open={Boolean(detail)} onOpenChange={(v) => !v && setDetail(null)}>
        <DialogContent>
          {detail ? (
            <>
              <DialogHeader>
                <DialogTitle>{str(detail.lead.business_name) ?? `Lead #${detail.lead.id}`}</DialogTitle>
                <p className="text-xs text-muted-foreground">
                  {str(detail.lead.lead_code) ?? `#${detail.lead.id}`} · {str(detail.lead.category_name) ?? "—"} ·{" "}
                  {str(detail.lead.city_keyword) ?? "—"}
                </p>
              </DialogHeader>
              <div className="space-y-3 p-4">
                {/* all 14 fields, filtered/masked by the viewer's policy */}
                <FieldGrid
                  fields={toPolicyFields(
                    detail.lead as Record<string, unknown>,
                    Object.fromEntries(LEAD_FIELDS.map((f) => [f.key, f.label])),
                    detail.fieldPolicy ?? {},
                    { gmap_link: "link", website_url: "link", phone: "phone", phone_normalized: "phone" },
                  )}
                />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Field label="Contact" value={detail.lead.contactName ?? "—"} />
                  <Field label="Assigned To" value={detail.agentName ?? "Pool"} />
                  <Field label="Deal value" value={detail.lead.dealAmount ? inr(detail.lead.dealAmount) : "—"} />
                  <Field label="Batch" value={detail.lead.batchId ?? "—"} />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={detail.lead.accessUnlocked ? "outline" : "default"}
                    onClick={() => void patchLead(detail.lead.id, { action: detail.lead.accessUnlocked ? "lock" : "unlock" })}
                  >
                    {detail.lead.accessUnlocked ? <Lock className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    {detail.lead.accessUnlocked ? "Lock details" : "Unlock details"}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => void patchLead(detail.lead.id, { action: "status", status: "CALLBACK" })}>
                    Mark callback
                  </Button>
                </div>

                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Call logs</p>
                  <div className="mt-1 space-y-1">
                    {detail.logs.length === 0 ? <p className="text-xs text-muted-foreground">No calls yet.</p> : null}
                    {detail.logs.map((l) => (
                      <div key={l.id} className="rounded-lg bg-slate-50 p-2 text-xs">
                        <p className="font-semibold">
                          {l.agentName ?? "Unknown"} · {l.status.replace("_", " ")} · {l.durationSeconds}s
                          {l.whatsappSent ? " · WhatsApp ✓" : ""}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {l.notes ?? "—"} · {dateTime(l.createdAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Audit trail</p>
                  <div className="mt-1 space-y-1">
                    {detail.trail.map((t) => (
                      <p key={t.id} className="text-[11px] text-muted-foreground">
                        <span className="font-semibold text-slate-700">{t.action}</span> · {t.detail ?? ""} · user #{t.actorId ?? "system"} ·{" "}
                        {dateTime(t.createdAt)}
                      </p>
                    ))}
                  </div>
                </div>

                {/* management: edit any field / reassign + private change timeline */}
                <LeadEditPanel
                  leadId={detail.lead.id}
                  lead={detail.lead as unknown as Record<string, unknown>}
                  onSaved={() => {
                    void openDetail(detail.lead.id);
                    void load();
                  }}
                />
                <LeadHistoryTimeline entries={detail.history ?? []} />

                {detail.proofs.length ? (
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Proofs</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {detail.proofs.map((p) =>
                        p.url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={p.id} src={p.url} alt={p.kind} className="h-16 w-16 rounded-lg border object-cover" />
                        ) : null,
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function useAppNicheReset() {
  return undefined;
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
    </svg>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-slate-50 p-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate font-medium">{value}</p>
    </div>
  );
}
