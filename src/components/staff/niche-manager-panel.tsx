"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Eye, EyeOff, Loader2, Plus, RefreshCcw, Save, Tags } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Input, Label, SectionCard, Stat, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/dialog";
import { cn, num } from "@/lib/utils";

type Niche = {
  id: number;
  name: string;
  slug: string;
  color: string;
  description: string | null;
  total: number;
  assigned: number;
  closed: number;
  agents: number;
  visibleToAgents: boolean;
  agentVisibleLeads?: number;
};

const PALETTE = ["#2563eb", "#0ea5e9", "#8b5cf6", "#f59e0b", "#ec4899", "#10b981", "#ef4444", "#14b8a6"];

export function NicheManagerPanel() {
  const [rows, setRows] = useState<Niche[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", color: PALETTE[0], visibleToAgents: true });

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/niches");
    if (res.ok) {
      const json = (await res.json()) as { rows: Niche[] };
      setRows(json.rows ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    setBusy(true);
    const res = await fetch("/api/niches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const json = (await res.json()) as { error?: string };
    if (res.ok) {
      toast.success(`Niche “${form.name}” created — now live in the sidebar and dropdowns`);
      setAddOpen(false);
      setForm({ name: "", description: "", color: PALETTE[0], visibleToAgents: true });
      await load();
    } else toast.error(json.error ?? "Could not create niche");
    setBusy(false);
  }

  async function patch(id: number, body: Record<string, unknown>) {
    const res = await fetch("/api/niches", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...body }),
    });
    if (res.ok) {
      toast.success("Niche updated");
      await load();
    } else toast.error("Update failed");
  }

  const totalLeads = rows.reduce((s, r) => s + r.total, 0);

  return (
    <div className="space-y-3 p-3 sm:p-4 lg:p-6">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Niches" value={num(rows.length)} hint="sidebar + dropdowns" />
        <Stat label="Leads covered" value={num(totalLeads)} tone="info" />
        <Stat label="Agents mapped" value={num(rows.reduce((s, r) => s + r.agents, 0))} tone="success" />
      </div>

      <SectionCard
        title="Show Niches"
        icon={<Tags className="h-3.5 w-3.5" />}
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void load()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" /> Add New Niche
            </Button>
          </div>
        }
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((n) => (
            <div key={n.id} className="rounded-xl border p-3">
              <div className="flex items-start gap-2">
                <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: n.color }} />
                <div className="min-w-0 flex-1">
                  <input
                    defaultValue={n.name}
                    onBlur={(e) => e.target.value.trim() !== n.name && void patch(n.id, { name: e.target.value })}
                    className="w-full rounded border-0 bg-transparent p-0 text-sm font-bold focus:outline-none focus:ring-1 focus:ring-blue-400"
                    aria-label="Niche name"
                  />
                  <p className="truncate font-mono text-[10px] text-muted-foreground">{n.slug}</p>
                </div>
                <Badge variant="outline" className="shrink-0">
                  <Eye className="h-2.5 w-2.5" /> shown
                </Badge>
              </div>
              <p className="mt-1.5 line-clamp-2 text-[11px] text-muted-foreground">{n.description ?? "No description"}</p>
              {/* visibility switch */}
              <button
                onClick={() => void patch(n.id, { visibleToAgents: !n.visibleToAgents })}
                disabled={busy}
                className={cn(
                  "mt-2 flex w-full items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-left transition",
                  n.visibleToAgents ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50",
                )}
              >
                <span className="min-w-0">
                  <span className={cn("block text-[11px] font-bold", n.visibleToAgents ? "text-emerald-800" : "text-rose-800")}>
                    {n.visibleToAgents ? "Visible to Agents" : "Hidden from Agents"}
                  </span>
                  <span className="block text-[9px] text-muted-foreground">
                    {n.visibleToAgents
                      ? `${num(n.assigned)} lead(s) in agent workspaces`
                      : "removed from agent sidebar + workspace"}
                  </span>
                </span>
                <span
                  className={cn(
                    "relative h-5 w-9 shrink-0 rounded-full transition",
                    n.visibleToAgents ? "bg-emerald-500" : "bg-slate-300",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all",
                      n.visibleToAgents ? "left-4.5" : "left-0.5",
                    )}
                    style={{ left: n.visibleToAgents ? "1.125rem" : "0.125rem" }}
                  />
                </span>
              </button>

              <div className="mt-2 grid grid-cols-3 gap-1 text-center text-[10px]">
                <div className="rounded bg-slate-50 p-1">
                  <p className="text-muted-foreground">Leads</p>
                  <p className="font-bold tabular-nums">{num(n.total)}</p>
                </div>
                <div className="rounded bg-slate-50 p-1">
                  <p className="text-muted-foreground">Assigned</p>
                  <p className="font-bold tabular-nums">{num(n.assigned)}</p>
                </div>
                <div className="rounded bg-slate-50 p-1">
                  <p className="text-muted-foreground">Won</p>
                  <p className="font-bold tabular-nums text-emerald-700">{num(n.closed)}</p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {PALETTE.map((c) => (
                  <button
                    key={c}
                    onClick={() => void patch(n.id, { color: c })}
                    aria-label={`Set colour ${c}`}
                    className={cn(
                      "h-4 w-4 rounded-full border",
                      n.color === c ? "border-slate-900 ring-1 ring-slate-900" : "border-transparent",
                    )}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        {rows.length === 0 && !loading ? <p className="text-xs text-muted-foreground">No niches yet — add your first category.</p> : null}
      </SectionCard>

      <Sheet
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add New Niche"
        description="Appears instantly in the sidebar, category dropdowns and lead filters."
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button className="flex-1" disabled={busy || form.name.trim().length < 2} onClick={() => void create()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Create niche
            </Button>
          </div>
        }
      >
        <div className="space-y-2">
          <div className="space-y-1">
            <Label>Niche name *</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Insurance Agents" />
          </div>
          <div className="space-y-1">
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Life & general insurance brokers"
              className="min-h-[64px]"
            />
          </div>
          <div className="space-y-1">
            <Label>Agent visibility</Label>
            <button
              onClick={() => setForm({ ...form, visibleToAgents: !form.visibleToAgents })}
              className={cn(
                "flex w-full items-center justify-between rounded-lg border px-2 py-2 text-left text-xs font-semibold",
                form.visibleToAgents ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800",
              )}
            >
              {form.visibleToAgents ? "Visible to Agents" : "Hidden from Agents"}
              <span className={cn("relative h-5 w-9 rounded-full transition", form.visibleToAgents ? "bg-emerald-500" : "bg-slate-300")}>
                <span
                  className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all"
                  style={{ left: form.visibleToAgents ? "1.125rem" : "0.125rem" }}
                />
              </span>
            </button>
          </div>
          <div className="space-y-1">
            <Label>Colour tag</Label>
            <div className="flex flex-wrap gap-2">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  onClick={() => setForm({ ...form, color: c })}
                  aria-label={`Pick ${c}`}
                  className={cn("h-7 w-7 rounded-full border-2", form.color === c ? "border-slate-900" : "border-transparent")}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
