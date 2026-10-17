"use client";

import { useCallback, useEffect, useState } from "react";
import { Banknote, Clock, Gift, Lock, TrendingUp, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, DesktopTable, EmptyState, Input, Label, MobileList, NativeSelect, SectionCard, Stat } from "@/components/ui/field";
import { cn, dateTime, hms, inr, num } from "@/lib/utils";

const TIER_SHORT = ["0–15", "16–30", "31–50", "51–75", "75+"];

type Deal = {
  id: number;
  leadId: number;
  businessName: string;
  leadName: string | null;
  city: string | null;
  amount: string;
  commission: string;
  slabLabel: string | null;
  bonusAmount: string;
  status: string;
  proofUrl: string | null;
  rejectionReason: string | null;
  reviewNote: string | null;
  decidedAt: string | null;
  createdAt: string;
};

type Bonus = { id: number; amount: string; title: string; note: string | null; status: string; createdAt: string };

type Profile = {
  profile: {
    name?: string;
    walletTotal: string;
    walletPending: string;
    walletApproved: string;
    commissionPerDeal: string;
    upiId: string | null;
    bankName: string | null;
    bankAccount: string | null;
    activeSeconds: number;
    payoutLocked?: boolean;
  } | null;
  earnings?: Deal[];
  bonuses?: Bonus[];
  payouts?: Array<{ id: number; amount: string; method: string; status: string; createdAt: string; reviewNote: string | null }>;
  commission?: {
    closes: number;
    amount: number;
    slab: { label: string; custom?: boolean } | null;
    tiers?: Array<{ tierIndex: number; label: string; minCloses: number; maxCloses: number | null; amountPerClose: string; custom: boolean }>;
    nextSlab: { label: string; minCloses: number } | null;
  };
  earningsSummary?: {
    approvedCommission: number;
    pendingCommission: number;
    rejectedCommission: number;
    bonusTotal: number;
    approvedCount: number;
  };
};

export function AgentEarnings() {
  const [data, setData] = useState<Profile | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("UPI");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/agent/profile?include=earnings");
    if (res.ok) setData(await res.json());
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function requestPayout() {
    setBusy(true);
    const res = await fetch("/api/agent/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: Number(amount), method, destination: data?.profile?.upiId ?? data?.profile?.bankAccount }),
    });
    const json = (await res.json()) as { error?: string };
    if (res.ok && !json.error) {
      toast.success("Payout request submitted");
      setAmount("");
      await load();
    } else {
      toast.error(json.error ?? "Request failed");
    }
    setBusy(false);
  }

  const earnings = data?.earnings ?? [];
  const summary = data?.earningsSummary;
  const approved = earnings.filter((e) => e.status === "APPROVED");
  const rejected = earnings.filter((e) => e.status === "REJECTED");
  const bonusTotal = summary?.bonusTotal ?? 0;
  const commissionTotal = summary?.approvedCommission ?? 0;

  return (
    <div className="space-y-3 p-3 lg:p-6">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Stat label="Wallet total" value={inr(data?.profile?.walletTotal)} hint="lifetime credit" />
        <Stat label="Pending payout" value={inr(data?.profile?.walletPending)} hint="awaiting transfer" tone="warn" />
        <Stat label="Withdrawn" value={inr(data?.profile?.walletApproved)} hint="paid to bank/UPI" tone="success" />
        <Stat label="Lead commission" value={inr(commissionTotal)} hint={`${num(summary?.approvedCount ?? 0)} approved deals`} tone="info" />
        <Stat label="Bonuses" value={inr(bonusTotal)} hint="custom awards" tone="default" />
      </div>

      {/* ---------- slab position ---------- */}
      {data?.commission ? (
        <SectionCard title="Your Commission Slab" icon={<TrendingUp className="h-3.5 w-3.5" />}>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
            {(data.commission.tiers ?? []).map((s, i) => {
              const active = data.commission?.slab && data.commission.slab.label === s.label;
              return (
                <div
                  key={s.tierIndex}
                  className={cn("rounded-xl border p-2.5 text-center", active ? "border-emerald-300 bg-emerald-50" : "bg-white")}
                >
                  <p className="truncate text-[10px] font-bold uppercase tracking-wide text-muted-foreground">T{s.tierIndex}</p>
                  <p className="truncate text-[9px] text-muted-foreground">{TIER_SHORT[i]}</p>
                  <p className={cn("mt-0.5 text-lg font-bold tabular-nums", active ? "text-emerald-700" : "text-foreground")}>
                    {inr(s.amountPerClose)}
                  </p>
                  {active ? <Badge variant="success" className="mt-1">current</Badge> : null}
                  {s.custom ? <Badge variant="warn" className="mt-1">custom</Badge> : null}
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            You have <strong>{num(data.commission.closes)}</strong> approved close(s) → earning{" "}
            <strong>{inr(data.commission.amount)}</strong> per close in <strong>{data.commission.slab?.label ?? "—"}</strong>.
            {data.commission.nextSlab
              ? ` Reach ${data.commission.nextSlab.minCloses} closes to move into ${data.commission.nextSlab.label}.`
              : " You are in the top tier."}
            {data.commission.slab?.custom ? " Your Tier rates were set manually by management." : ""}
          </p>
        </SectionCard>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionCard title="Earnings Breakdown — per closed deal" icon={<Wallet className="h-3.5 w-3.5" />}>
            {earnings.length === 0 ? (
              <EmptyState
                title="No deals submitted yet"
                hint="Enter the Deal Value when moving a lead to Payment Approval and it will appear here itemized."
                icon="💸"
              />
            ) : (
              <>
                {/* desktop table */}
                <DesktopTable>
                  <table className="w-full min-w-[720px] text-left text-xs">
                    <thead className="border-b bg-slate-50 text-[10px] uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="p-2">Agent</th>
                        <th className="p-2">Lead name</th>
                        <th className="p-2">Business</th>
                        <th className="p-2">Deal value</th>
                        <th className="p-2">Slab</th>
                        <th className="p-2">Commission</th>
                        <th className="p-2">Approval date</th>
                        <th className="p-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {earnings.map((d) => (
                        <tr key={d.id} className="border-b last:border-0">
                          <td className="p-2 font-medium">{data?.profile?.name?.split(" ")[0] ?? "—"}</td>
                          <td className="p-2">{d.leadName ?? "—"}</td>
                          <td className="p-2">
                            {d.businessName}
                            <span className="block text-[10px] text-muted-foreground">
                              #{d.leadId} · {d.city ?? "—"}
                            </span>
                          </td>
                          <td className="p-2 tabular-nums">{inr(d.amount)}</td>
                          <td className="p-2">
                            <Badge variant="muted">{d.slabLabel ?? "flat"}</Badge>
                          </td>
                          <td className="p-2 font-semibold tabular-nums text-emerald-700">{inr(d.commission)}</td>
                          <td className="p-2 text-muted-foreground">{d.decidedAt ? dateTime(d.decidedAt) : "pending"}</td>
                          <td className="p-2">
                            <Badge variant={d.status === "APPROVED" ? "success" : d.status === "PENDING" ? "warn" : "danger"}>
                              {d.status}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </DesktopTable>

                {/* mobile cards */}
                <MobileList className="mt-3 lg:mt-0">
                  {earnings.map((d) => (
                    <div key={d.id} className="rounded-xl border bg-white p-3 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-bold">{d.businessName}</p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            #{d.leadId} · {d.leadName ?? "—"} · {d.city ?? "—"}
                          </p>
                        </div>
                        <Badge variant={d.status === "APPROVED" ? "success" : d.status === "PENDING" ? "warn" : "danger"}>{d.status}</Badge>
                      </div>
                      <p className="mt-2 rounded-lg bg-emerald-50 px-2 py-1.5 text-[11px] font-medium text-emerald-800">
                        {data?.profile?.name?.split(" ")[0] ?? "Agent"} | {d.leadName ?? "—"} | {d.businessName} |{" "}
                        {d.decidedAt ? dateTime(d.decidedAt) : "pending"} | {inr(d.commission)}
                      </p>
                      <div className="mt-2 grid grid-cols-3 gap-1.5 text-center text-[11px]">
                        <div className="rounded-lg bg-slate-50 p-1.5">
                          <p className="text-[9px] uppercase text-muted-foreground">Deal value</p>
                          <p className="font-bold tabular-nums">{inr(d.amount)}</p>
                        </div>
                        <div className="rounded-lg bg-emerald-50 p-1.5">
                          <p className="text-[9px] uppercase text-emerald-700">Commission</p>
                          <p className="font-bold tabular-nums text-emerald-700">{inr(d.commission)}</p>
                        </div>
                        <div className="rounded-lg bg-violet-50 p-1.5">
                          <p className="text-[9px] uppercase text-violet-700">Slab</p>
                          <p className="truncate font-bold">{d.slabLabel ?? "flat"}</p>
                        </div>
                      </div>
                      {d.status === "REJECTED" ? (
                        <p className="mt-2 rounded-lg bg-rose-50 px-2 py-1.5 text-[10px] text-rose-700">
                          <strong>Rejected:</strong> {d.rejectionReason ?? d.reviewNote ?? "No reason recorded."}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </MobileList>

                {/* itemized totals */}
                <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
                  <Stat label="Approved commission" value={inr(commissionTotal)} tone="success" />
                  <Stat label="Pending commission" value={inr(summary?.pendingCommission ?? 0)} tone="warn" />
                  <Stat label="Rejected value" value={inr(summary?.rejectedCommission ?? 0)} tone="danger" />
                  <Stat label="Bonus vs commission" value={`${inr(bonusTotal)} / ${inr(commissionTotal)}`} tone="info" />
                </div>
              </>
            )}
          </SectionCard>

          {rejected.length ? (
            <SectionCard title="Rejected Deals — re-submit available" icon={<Banknote className="h-3.5 w-3.5" />} className="mt-3">
              <div className="space-y-2">
                {rejected.map((d) => (
                  <div key={d.id} className="rounded-xl border border-rose-200 bg-rose-50 p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-rose-900">
                          {d.businessName} · {inr(d.amount)}
                        </p>
                        <p className="text-[11px] text-rose-700">{d.rejectionReason ?? d.reviewNote ?? "No reason recorded."}</p>
                      </div>
                      <Badge variant="danger">rejected</Badge>
                    </div>
                    <p className="mt-1 text-[10px] text-rose-600">
                      Open the lead in My Leads and use “Re-upload Proof” to re-submit.
                    </p>
                  </div>
                ))}
              </div>
            </SectionCard>
          ) : null}
        </div>

        <div className="space-y-3">
          <SectionCard title="Withdraw earnings" icon={<Banknote className="h-3.5 w-3.5" />}>
            <div className="space-y-2">
              <div className="space-y-1">
                <Label>Amount (₹)</Label>
                <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2000" />
              </div>
              <div className="space-y-1">
                <Label>Method</Label>
                <NativeSelect value={method} onChange={(e) => setMethod(e.target.value)}>
                  <option value="UPI">UPI · {data?.profile?.upiId ?? "not set"}</option>
                  <option value="BANK">Bank · {data?.profile?.bankName ?? "not set"}</option>
                </NativeSelect>
              </div>
              <Button size="lg" className="w-full" disabled={busy || !amount} onClick={() => void requestPayout()}>
                Request payout
              </Button>
              <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Lock className="h-3 w-3" /> Payouts are approved in the Approvals Center.
              </p>
            </div>
          </SectionCard>

          <SectionCard title="Bonus ledger" icon={<Gift className="h-3.5 w-3.5" />}>
            <div className="space-y-1.5">
              {(data?.bonuses ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">No bonuses yet.</p>
              ) : null}
              {(data?.bonuses ?? []).map((b) => (
                <div key={b.id} className="rounded-lg border p-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs font-semibold">{b.title}</p>
                    <span className="shrink-0 font-bold tabular-nums text-violet-700">{inr(b.amount)}</span>
                  </div>
                  {b.note ? <p className="truncate text-[11px] text-muted-foreground">{b.note}</p> : null}
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{dateTime(b.createdAt)}</p>
                </div>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Payout history" icon={<Clock className="h-3.5 w-3.5" />}>
            <div className="space-y-2">
              {(data?.payouts ?? []).length === 0 ? <p className="text-xs text-muted-foreground">No payout requests yet.</p> : null}
              {(data?.payouts ?? []).map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-lg bg-slate-50 p-2 text-xs">
                  <div>
                    <p className="font-semibold">{inr(p.amount)}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {p.method} · {dateTime(p.createdAt)}
                    </p>
                  </div>
                  <Badge variant={p.status === "APPROVED" ? "success" : p.status === "PENDING" ? "warn" : "danger"}>{p.status}</Badge>
                </div>
              ))}
            </div>
            <p className="mt-3 rounded-lg bg-emerald-50 p-2 text-[11px] text-emerald-700">
              ⏱ Lifetime tracked active time: {hms(data?.profile?.activeSeconds ?? 0)} (tab-visible only)
            </p>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
