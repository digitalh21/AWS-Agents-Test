"use client";

import { useCallback, useEffect, useState } from "react";
import { Award, Gift, Loader2, Plus, RefreshCcw, Save, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Input, Label, NativeSelect, SectionCard, Stat, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/dialog";
import { cn, inr, num } from "@/lib/utils";

type Slab = { id?: number; label: string; minCloses: number; maxCloses: number | null; amountPerClose: string | number };
type Agent = {
  id: string;
  name: string;
  email: string;
  closes: number;
  bonusTotal: number;
  commissionTotal: number;
  walletPending: string;
  walletApproved: string;
};
type Bonus = { id: number; userId: string; agentName: string; amount: string; title: string; note: string | null; status: string; createdAt: string };
type Deal = {
  id: number;
  agentId: string;
  agentName: string;
  leadId: number;
  amount: string;
  commission: string;
  slabLabel: string | null;
  status: string;
  decidedAt: string | null;
  createdAt: string;
};

export function CommissionPanel() {
  const [slabs, setSlabs] = useState<Slab[]>([]);
  const [draft, setDraft] = useState<Slab[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [bonuses, setBonuses] = useState<Bonus[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bonusOpen, setBonusOpen] = useState(false);
  const [bonusForm, setBonusForm] = useState({ userId: "", amount: "", title: "Performance Bonus", note: "" });

  const load = useCallback(async () => {
    const res = await fetch("/api/commission");
    if (res.ok) {
      const json = (await res.json()) as {
        slabs: Slab[];
        agents: Agent[];
        bonuses: Bonus[];
        deals?: Deal[];
        viewer: { canEdit: boolean };
      };
      setSlabs(json.slabs);
      setDraft(json.slabs);
      setAgents(json.agents);
      setBonuses(json.bonuses ?? []);
      setDeals(json.deals ?? []);
      setCanEdit(json.viewer.canEdit);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveSlabs() {
    setBusy(true);
    const res = await fetch("/api/commission", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slabs: draft }),
    });
    const json = (await res.json()) as { error?: string; saved?: number };
    if (res.ok) {
      toast.success(`${json.saved} commission slab(s) saved`);
      await load();
    } else toast.error(json.error ?? "Save failed");
    setBusy(false);
  }

  /** Toggle an earnings entry between PENDING and APPROVED (wallet stays in sync server-side). */
  async function setEarningStatus(id: number, kind: "deal" | "bonus", status: "PENDING" | "APPROVED") {
    setBusy(true);
    const res = await fetch(`/api/commission/${id}?kind=${kind}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const json = (await res.json()) as { error?: string };
    if (res.ok) {
      toast.success(`Marked ${status.toLowerCase()}`);
      await load();
    } else toast.error(json.error ?? "Update failed");
    setBusy(false);
  }

  /** Delete an earnings entry and reverse any wallet credit. */
  async function deleteEarning(id: number, kind: "deal" | "bonus") {
    if (!window.confirm("Delete this earnings entry? Any wallet credit already applied will be reversed.")) return;
    setBusy(true);
    const res = await fetch(`/api/commission/${id}?kind=${kind}`, { method: "DELETE" });
    const json = (await res.json()) as { error?: string };
    if (res.ok) {
      toast.success("Entry deleted");
      await load();
    } else toast.error(json.error ?? "Delete failed");
    setBusy(false);
  }

  async function grantBonus() {
    setBusy(true);
    const res = await fetch("/api/commission", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: bonusForm.userId,
        amount: Number(bonusForm.amount),
        title: bonusForm.title,
        note: bonusForm.note,
      }),
    });
    const json = (await res.json()) as { error?: string };
    if (res.ok) {
      toast.success(`Bonus of ${inr(bonusForm.amount)} credited`);
      setBonusOpen(false);
      setBonusForm({ userId: "", amount: "", title: "Performance Bonus", note: "" });
      await load();
    } else toast.error(json.error ?? "Could not grant bonus");
    setBusy(false);
  }

  const dirty = JSON.stringify(slabs) !== JSON.stringify(draft);

  function updateSlab(i: number, patch: Partial<Slab>) {
    setDraft((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  function addSlab() {
    const last = draft[draft.length - 1];
    const min = last && last.maxCloses !== null ? Number(last.maxCloses) + 1 : 0;
    setDraft([...draft, { label: `${min}+ Closes`, minCloses: min, maxCloses: null, amountPerClose: 500 }]);
  }

  const totalBonus = bonuses.filter((b) => b.status === "APPROVED").reduce((s, b) => s + Number(b.amount), 0);

  return (
    <div className="space-y-3 p-3 sm:p-4 lg:p-6">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Active slabs" value={num(slabs.length)} hint="tiered per close" />
        <Stat label="Bonuses paid" value={inr(totalBonus)} tone="warn" hint="all agents" />
        <Stat label="Commission earned" value={inr(agents.reduce((s, a) => s + a.commissionTotal, 0))} tone="success" />
        <Stat label="Agents" value={num(agents.length)} hint={`${num(agents.reduce((s, a) => s + a.closes, 0))} closes total`} />
      </div>

      {/* ---------- tiered slabs ---------- */}
      <SectionCard
        title="Tiered Commission Slabs (per close)"
        icon={<TrendingUp className="h-3.5 w-3.5" />}
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={addSlab} disabled={!canEdit}>
              <Plus className="h-4 w-4" /> Slab
            </Button>
            <Button size="sm" onClick={() => void saveSlabs()} disabled={busy || !dirty || !canEdit}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
            </Button>
          </div>
        }
      >
        <div className="space-y-2">
          <div className="hidden gap-2 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid sm:grid-cols-12">
            <span className="col-span-4">Label</span>
            <span className="col-span-2">Min closes</span>
            <span className="col-span-2">Max closes</span>
            <span className="col-span-3">₹ per close</span>
            <span className="col-span-1" />
          </div>
          {draft.map((slab, i) => (
            <div key={slab.id ?? `new-${i}`} className="grid gap-2 rounded-xl border p-2 sm:grid-cols-12 sm:items-end sm:border-0 sm:p-0">
              <div className="space-y-1 sm:col-span-4">
                <Label className="sm:hidden">Label</Label>
                <Input value={slab.label} onChange={(e) => updateSlab(i, { label: e.target.value })} disabled={!canEdit} />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="sm:hidden">Min closes</Label>
                <Input
                  inputMode="numeric"
                  value={slab.minCloses}
                  onChange={(e) => updateSlab(i, { minCloses: Number(e.target.value.replace(/[^0-9]/g, "")) })}
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="sm:hidden">Max closes</Label>
                <Input
                  inputMode="numeric"
                  value={slab.maxCloses ?? ""}
                  placeholder="∞"
                  onChange={(e) =>
                    updateSlab(i, { maxCloses: e.target.value === "" ? null : Number(e.target.value.replace(/[^0-9]/g, "")) })
                  }
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-1 sm:col-span-3">
                <Label className="sm:hidden">₹ per close</Label>
                <Input
                  inputMode="decimal"
                  value={slab.amountPerClose}
                  onChange={(e) => updateSlab(i, { amountPerClose: e.target.value.replace(/[^0-9.]/g, "") })}
                  disabled={!canEdit}
                />
              </div>
              <div className="sm:col-span-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full text-rose-600"
                  disabled={!canEdit || draft.length <= 1}
                  onClick={() => setDraft(draft.filter((_, idx) => idx !== i))}
                >
                  ✕
                </Button>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          Commission is resolved from each agent&apos;s <strong>approved</strong> close count at submission time and stored on the deal, so
          historical payouts never change retroactively. Leave “Max closes” blank for the top tier.
        </p>
      </SectionCard>

      {/* ---------- agent tier positions ---------- */}
      <SectionCard title="Agent tier position & earnings" icon={<Award className="h-3.5 w-3.5" />}>
        <div className="overflow-x-auto thin-scroll">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="border-b text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="p-2">Agent</th>
                <th className="p-2">Closes</th>
                <th className="p-2">Current slab</th>
                <th className="p-2">Commission</th>
                <th className="p-2">Bonus</th>
                <th className="p-2">Pending wallet</th>
                <th className="p-2 text-right">Bonus action</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => {
                const slab = [...draft].reverse().find((s) => a.closes >= Number(s.minCloses));
                return (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="p-2">
                      <p className="font-semibold">{a.name}</p>
                      <p className="text-[10px] text-muted-foreground">{a.email}</p>
                    </td>
                    <td className="p-2 font-bold tabular-nums">{num(a.closes)}</td>
                    <td className="p-2">
                      <Badge variant="muted">{slab?.label ?? "—"}</Badge>
                      <span className="mt-0.5 block text-[10px] text-muted-foreground">{inr(slab?.amountPerClose ?? 0)} / close</span>
                    </td>
                    <td className="p-2 tabular-nums text-emerald-700">{inr(a.commissionTotal)}</td>
                    <td className="p-2 tabular-nums text-violet-700">{inr(a.bonusTotal)}</td>
                    <td className="p-2 tabular-nums">{inr(a.walletPending)}</td>
                    <td className="p-2 text-right">
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={!canEdit}
                        onClick={() => {
                          setBonusForm((f) => ({ ...f, userId: a.id }));
                          setBonusOpen(true);
                        }}
                      >
                        <Gift className="h-3 w-3" /> Bonus
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* ---------- bonus history ---------- */}
      <SectionCard title="Bonus ledger" icon={<Gift className="h-3.5 w-3.5" />}>
        <div className="space-y-1.5">
          {bonuses.length === 0 ? <p className="text-xs text-muted-foreground">No bonuses granted yet.</p> : null}
          {bonuses.map((b) => (
            <div key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold">
                  {b.agentName} · {b.title}
                </p>
                {b.note ? <p className="truncate text-[11px] text-muted-foreground">{b.note}</p> : null}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-bold tabular-nums text-violet-700">{inr(b.amount)}</span>
                <Badge variant={b.status === "APPROVED" ? "success" : b.status === "PENDING" ? "warn" : "danger"}>{b.status}</Badge>
                {canEdit ? (
                  <>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void setEarningStatus(b.id, "bonus", b.status === "APPROVED" ? "PENDING" : "APPROVED")}
                    >
                      {b.status === "APPROVED" ? "Set Pending" : "Approve"}
                    </Button>
                    <Button size="xs" variant="ghost" className="text-rose-600" disabled={busy} onClick={() => void deleteEarning(b.id, "bonus")}>
                      Delete
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        <Button
          variant="outline"
          className="mt-2 w-full"
          disabled={!canEdit}
          onClick={() => {
            setBonusForm((f) => ({ ...f, userId: agents[0]?.id ?? "" }));
            setBonusOpen(true);
          }}
        >
          <Gift className="h-4 w-4" /> Send custom bonus
        </Button>
      </SectionCard>

      <Sheet
        open={bonusOpen}
        onOpenChange={setBonusOpen}
        title="Grant a custom bonus"
        description="Credited to the agent's pending wallet immediately and shown separately from lead commission."
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setBonusOpen(false)}>
              Cancel
            </Button>
            <Button className="flex-1" disabled={busy || !bonusForm.userId || !bonusForm.amount} onClick={() => void grantBonus()}>
              <Gift className="h-4 w-4" /> Credit bonus
            </Button>
          </div>
        }
      >
        <div className="space-y-2">
          <div className="space-y-1">
            <Label>Agent</Label>
            <NativeSelect value={bonusForm.userId} onChange={(e) => setBonusForm({ ...bonusForm, userId: e.target.value })}>
              <option value="">— select agent —</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.closes} closes)
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label>Amount (₹)</Label>
            <Input
              inputMode="decimal"
              value={bonusForm.amount}
              onChange={(e) => setBonusForm({ ...bonusForm, amount: e.target.value.replace(/[^0-9.]/g, "") })}
              placeholder="2500"
            />
          </div>
          <div className="space-y-1">
            <Label>Title</Label>
            <Input value={bonusForm.title} onChange={(e) => setBonusForm({ ...bonusForm, title: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Note</Label>
            <Textarea
              value={bonusForm.note}
              onChange={(e) => setBonusForm({ ...bonusForm, note: e.target.value })}
              placeholder="Diwali performance bonus / exceeded 30 closes this month"
              className="min-h-[64px]"
            />
          </div>
        </div>
      </Sheet>

      {!canEdit ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          Your role can view commission data but only ADMIN / HR / MANAGER can edit slabs or grant bonuses.
        </p>
      ) : null}
    </div>
  );
}
