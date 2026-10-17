"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Gauge, Loader2, RotateCcw, Save, Search, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, DesktopTable, Input, Label, MobileList, SectionCard, Stat } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { Sheet } from "@/components/ui/dialog";
import { cn, inr, num } from "@/lib/utils";

type Tier = { tierIndex: number; label: string; minCloses: number; maxCloses: number | null; amountPerClose: string; custom: boolean };
type Agent = {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  nicheName: string | null;
  closes: number;
  dailyLeadQuota: number | null;
  tiers: Tier[];
  activeAmount: number;
};

const TIER_SHORT = ["T1 · 0–15", "T2 · 16–30", "T3 · 31–50", "T4 · 51–75", "T5 · 75+"];

export function AgentSlabsPanel() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [ladder, setLadder] = useState<Tier[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Agent | null>(null);
  const [rates, setRates] = useState<string[]>(["", "", "", "", ""]);
  const [quota, setQuota] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/agent/slabs?all=1");
    if (res.ok) {
      const json = (await res.json()) as { agents: Agent[]; ladder: Tier[] };
      setAgents(json.agents ?? []);
      setLadder(json.ladder ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openEditor(a: Agent) {
    setEditing(a);
    setRates(a.tiers.map((t) => String(Number(t.amountPerClose))));
    setQuota(a.dailyLeadQuota === null ? "" : String(a.dailyLeadQuota));
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    const res = await fetch("/api/agent/slabs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: editing.id,
        tiers: rates.map((amount, i) => ({ tierIndex: i + 1, amountPerClose: Number(amount || 0) })),
        dailyLeadQuota: quota === "" ? null : Number(quota),
      }),
    });
    const json = (await res.json()) as { error?: string };
    if (res.ok) {
      toast.success(`Saved ${editing.name}'s rates and per-day limit`);
      setEditing(null);
      await load();
    } else toast.error(json.error ?? "Save failed");
    setBusy(false);
  }

  async function resetTiers(agent: Agent) {
    setBusy(true);
    const res = await fetch("/api/agent/slabs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: agent.id, reset: true }),
    });
    if (res.ok) {
      toast.success(`${agent.name} reset to global tier rates`);
      await load();
    } else toast.error("Reset failed");
    setBusy(false);
  }

  async function saveQuotaInline(agent: Agent, value: string) {
    setBusy(true);
    const res = await fetch("/api/agent/slabs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: agent.id, dailyLeadQuota: value === "" ? null : Number(value) }),
    });
    if (res.ok) toast.success(`${agent.name}: ${value === "" ? "global default" : `${value} leads/day`}`);
    else toast.error("Could not save per-day limit");
    setBusy(false);
    await load();
  }

  const filtered = useMemo(
    () => agents.filter((a) => `${a.name} ${a.email}`.toLowerCase().includes(q.trim().toLowerCase())),
    [agents, q],
  );

  const totalQuota = agents.reduce((s, a) => s + (a.dailyLeadQuota ?? 0), 0);
  const customCount = agents.filter((a) => a.tiers.some((t) => t.custom)).length;

  return (
    <div className="space-y-3 p-3 sm:p-4 lg:p-6">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Agents" value={num(agents.length)} hint="rate cards configured" />
        <Stat label="Custom rate cards" value={num(customCount)} tone="warn" hint="override the global slabs" />
        <Stat label="Per Day Lead Limit capacity" value={num(totalQuota)} tone="info" hint="auto-assign ceiling/day across team" />
        <Stat label="Approved closes" value={num(agents.reduce((s, a) => s + a.closes, 0))} tone="success" />
      </div>

      {/* global ladder reference */}
      <SectionCard title="Global tier bounds (fixed)" icon={<TrendingUp className="h-3.5 w-3.5" />}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {ladder.map((t, i) => (
            <div key={t.tierIndex} className="rounded-xl border bg-slate-50 p-2 text-center">
              <p className="truncate text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{TIER_SHORT[i]}</p>
              <p className="mt-0.5 text-sm font-bold">default {inr(t.amountPerClose)}</p>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          The five tier boundaries are fixed; enter a custom ₹ per close for any agent below. A saved custom rate overrides the global default for
          that agent and tier only.
        </p>
      </SectionCard>

      <div className="flex items-center gap-2 rounded-xl border bg-white p-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-muted-foreground sm:left-2.5 sm:top-2.5 sm:h-4 sm:w-4" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search agent by name or email" className="pl-11 sm:pl-8" />
        </div>
        <Button variant="outline" size="icon" className="h-11 w-11 shrink-0 sm:h-10 sm:w-10" onClick={() => void load()} aria-label="Refresh">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
        </Button>
      </div>

      {/* desktop table */}
      <DesktopTable>
        <table className="w-full min-w-[980px] text-left text-xs">
          <thead className="border-b bg-slate-50 text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-2">Agent</th>
              <th className="p-2">Closes</th>
              <th className="p-2">Active rate</th>
              {TIER_SHORT.map((t) => (
                <th key={t} className="p-2">
                  {t}
                </th>
              ))}
              <th className="p-2">Per Day Lead Limit</th>
              <th className="p-2 text-right">Edit</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.id} className="border-b last:border-0">
                <td className="p-2">
                  <p className="font-semibold">{a.name}</p>
                  <p className="text-[10px] text-muted-foreground">{a.nicheName ?? "All niches"}</p>
                </td>
                <td className="p-2 font-bold tabular-nums">{num(a.closes)}</td>
                <td className="p-2">
                  <span className="font-bold tabular-nums text-emerald-700">{inr(a.activeAmount)}</span>
                  {a.tiers.some((t) => t.custom) ? <Badge variant="warn" className="ml-1">custom</Badge> : null}
                </td>
                {a.tiers.map((t) => (
                  <td key={t.tierIndex} className="p-2 tabular-nums">
                    {inr(t.amountPerClose)}
                    {t.custom ? <span className="ml-1 text-[9px] font-bold text-amber-600">•</span> : null}
                  </td>
                ))}
                <td className="p-2">
                  <Input
                    defaultValue={a.dailyLeadQuota ?? ""}
                    placeholder="∞"
                    inputMode="numeric"
                    className="h-8 w-20"
                    onBlur={(e) => {
                      const v = e.target.value;
                      if (v !== (a.dailyLeadQuota === null ? "" : String(a.dailyLeadQuota))) void saveQuotaInline(a, v);
                    }}
                  />
                  <span className="mt-0.5 block text-[9px] text-muted-foreground">leads/day</span>
                </td>
                <td className="p-2 text-right">
                  <Button size="xs" variant="secondary" onClick={() => openEditor(a)}>
                    Configure
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DesktopTable>

      {/* mobile cards */}
      <MobileList>
        {filtered.map((a) => (
          <div key={a.id} className="rounded-xl border bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{a.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">{a.nicheName ?? "All niches"}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-bold tabular-nums text-emerald-700">{inr(a.activeAmount)}</p>
                <p className="text-[10px] text-muted-foreground">{num(a.closes)} closes</p>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-5 gap-1 text-center">
              {a.tiers.map((t, i) => (
                <div key={t.tierIndex} className={cn("rounded-lg p-1", t.custom ? "bg-amber-50" : "bg-slate-50")}>
                  <p className="truncate text-[8px] text-muted-foreground">{TIER_SHORT[i]}</p>
                  <p className="text-[10px] font-bold tabular-nums">{Number(t.amountPerClose)}</p>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 space-y-1">
                <Label>Per Day Lead Limit</Label>
                <Input
                  defaultValue={a.dailyLeadQuota ?? ""}
                  placeholder="∞"
                  inputMode="numeric"
                  onBlur={(e) => {
                    const v = e.target.value;
                    if (v !== (a.dailyLeadQuota === null ? "" : String(a.dailyLeadQuota))) void saveQuotaInline(a, v);
                  }}
                />
              </div>
              <Button size="sm" variant="secondary" className="mt-4" onClick={() => openEditor(a)}>
                Configure
              </Button>
            </div>
          </div>
        ))}
      </MobileList>

      {/* ---------- editor sheet ---------- */}
      <Sheet
        open={Boolean(editing)}
        onOpenChange={(v) => !v && setEditing(null)}
        title={editing ? `Commission & per-day limit · ${editing.name}` : "Configure"}
        description="Manual ₹ per close for each of the five tiers, plus the daily auto-assign limit."
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button className="flex-1" disabled={busy} onClick={() => void save()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
            </Button>
          </div>
        }
      >
        {editing ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-50 p-2 text-xs">
              <span className="font-bold">{editing.name}</span>
              <Badge variant="muted">{editing.nicheName ?? "All niches"}</Badge>
              <Badge variant="success">{num(editing.closes)} approved closes</Badge>
              {editing.tiers.some((t) => t.custom) ? <Badge variant="warn">custom rates active</Badge> : null}
            </div>

            <div className="space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Commission per close (₹)</p>
              {editing.tiers.map((t, i) => (
                <div key={t.tierIndex} className="flex items-center gap-2 rounded-xl border p-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold">{TIER_SHORT[i]}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {t.minCloses}
                      {t.maxCloses === null ? "+" : `–${t.maxCloses}`} closes
                      {t.custom ? " · custom" : ""}
                    </p>
                  </div>
                  <div className="relative w-32 shrink-0">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">₹</span>
                    <NumberInput
                      value={rates[i] ?? ""}
                      onValueChange={(v) => setRates((prev) => prev.map((x, idx) => (idx === i ? v : x)))}
                      className="pl-7"
                      placeholder={String(Number(t.amountPerClose))}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-1.5 rounded-xl border border-blue-200 bg-blue-50/60 p-3">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-blue-800">
                <Gauge className="h-3.5 w-3.5" /> Daily auto-assign lead limit
              </p>
              <div className="flex items-center gap-2">
                <NumberInput
                  value={quota}
                  onValueChange={setQuota}
                  allowDecimal={false}
                  className="flex-1"
                  placeholder="unlimited"
                />
                <span className="shrink-0 text-[11px] text-blue-800">leads / day</span>
              </div>
              <p className="text-[10px] text-blue-700">
                Auto-assign pulls at most this many leads from the unassigned pool for {editing.name.split(" ")[0]} per calendar day. Leave blank
                for unlimited, or set 0 to pause new allocations.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="flex-1" disabled={busy} onClick={() => void resetTiers(editing)}>
                <RotateCcw className="h-4 w-4" /> Reset to global
              </Button>
              <Button size="sm" className="flex-1" disabled={busy} onClick={() => void save()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save rate card
              </Button>
            </div>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
