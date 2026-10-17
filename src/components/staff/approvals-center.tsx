"use client";

import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, CheckCircle2, Eye, HandCoins, RefreshCcw, XCircle } from "lucide-react";
import { toast } from "sonner";
import { SafeImage } from "@/components/shared/safe-image";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, Input, Stat } from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sheet } from "@/components/ui/dialog";
import { OpenLeadButton } from "@/components/shared/lead-peek";
import { cn, dateTime, inr, num, timeAgo, waLink } from "@/lib/utils";

type Deal = {
  id: number;
  leadId: number;
  businessName: string;
  leadPhone: string;
  city: string | null;
  agentId: string;
  agentName: string;
  agentPhone: string | null;
  amount: string;
  commission: string;
  proofUrl: string | null;
  agentNote: string | null;
  status: string;
  reviewNote: string | null;
  rejectionReason: string | null;
  createdAt: string;
  decidedAt: string | null;
};

type Payout = {
  id: number;
  userId: string;
  agentName: string;
  agentPhone: string | null;
  amount: string;
  method: string;
  destination: string | null;
  proofUrl: string | null;
  status: string;
  reviewNote: string | null;
  createdAt: string;
};

type Correction = {
  id: number;
  leadId: number;
  businessName: string;
  userId: string;
  agentName: string;
  reason: string;
  requestedStatus: string | null;
  status: string;
  resolvedNote: string | null;
  createdAt: string;
};

type LeadRequest = {
  id: number;
  userId: string;
  agentName: string;
  quantity: number;
  note: string | null;
  status: string;
  nicheName: string | null;
  createdAt: string;
};

type ReplaceReq = {
  id: number;
  kind: string;
  leadId: number | null;
  businessName: string | null;
  leadCode: string | null;
  leadStatus: string | null;
  agentId: string;
  agentName: string;
  agentPhone: string | null;
  nicheName: string | null;
  quantity: number;
  reason: string | null;
  note: string | null;
  status: string;
  resolvedNote: string | null;
  createdAt: string;
};

type HistoryReq = {
  id: number;
  leadId: number;
  businessName: string | null;
  leadCode: string | null;
  agentId: string;
  agentName: string;
  reason: string | null;
  status: string;
  resolvedNote: string | null;
  createdAt: string;
};

type Payload = {
  deals: Deal[];
  withdrawals: Payout[];
  corrections: Correction[];
  leadRequests: LeadRequest[];
  replaces?: ReplaceReq[];
  historyAccess?: HistoryReq[];
  counts: { deals: number; withdrawals: number; corrections: number; leadRequests: number };
  commissionSummary: { approvedCommission: number; pendingCommission: number };
  pendingPayout: { total: number };
};

export function ApprovalsCenter() {
  const [data, setData] = useState<Payload | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string>("");
  const [zoom, setZoom] = useState<{ url: string; label: string; note: string | null } | null>(null);
  const [scale, setScale] = useState(1);
  const [dealScope, setDealScope] = useState<"PENDING" | "APPROVED" | "REJECTED">("PENDING");

  const load = useCallback(async () => {
    const res = await fetch(`/api/approvals?scope=${dealScope}`);
    if (res.ok) setData(await res.json());
  }, [dealScope]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(kind: string, id: number, action: "APPROVE" | "REJECT") {
    setBusy(`${kind}-${id}`);
    const res = await fetch("/api/approvals/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, id, action, note: notes[`${kind}-${id}`] ?? undefined }),
    });
    const json = (await res.json()) as { error?: string };
    if (res.ok) {
      toast.success(`${action === "APPROVE" ? "Approved" : "Rejected"} successfully`);
      await load();
    } else toast.error(json.error ?? "Action failed");
    setBusy("");
  }

  /** Re-approve a rejected deal (Admin/HR/Manager) — the agent sees the reversal instantly. */
  async function reApprove(id: number) {
    setBusy(`deal-re-${id}`);
    const res = await fetch("/api/approvals/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "deal", id, action: "APPROVE", note: notes[`deal-re-${id}`] ?? "Re-approved after re-submission" }),
    });
    const json = (await res.json()) as { error?: string };
    if (res.ok) {
      toast.success("Deal re-approved — commission credited");
      await load();
    } else toast.error(json.error ?? "Action failed");
    setBusy("");
  }

  async function decideReplace(id: number, action: "APPROVE" | "REJECT") {
    setBusy(`replace-${id}`);
    const res = await fetch("/api/leads/requests", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, note: notes[`replace-${id}`] ?? undefined }),
    });
    const json = (await res.json()) as { error?: string; replacementId?: number | null };
    if (res.ok) {
      toast.success(action === "APPROVE" ? "Lead returned to pool and replacement assigned" : "Request rejected");
      await load();
    } else toast.error(json.error ?? "Action failed");
    setBusy("");
  }

  async function decideHistory(id: number, action: "APPROVE" | "REJECT") {
    setBusy(`history-${id}`);
    const res = await fetch("/api/leads/history-access", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    if (res.ok) {
      toast.success(action === "APPROVE" ? "History access granted" : "Access denied");
      await load();
    } else toast.error("Action failed");
    setBusy("");
  }

  const counts = data?.counts ?? { deals: 0, withdrawals: 0, corrections: 0, leadRequests: 0 };

  return (
    <div className="space-y-3 p-3 lg:p-6">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Deal approvals" value={num(counts.deals)} hint="payment proof review" tone="warn" />
        <Stat label="Payout requests" value={num(counts.withdrawals)} hint="wallet withdrawals" tone="info" />
        <Stat label="Corrections" value={num(counts.corrections)} hint="agent mistake requests" tone="danger" />
        <Stat label="Lead requests" value={num(counts.leadRequests)} hint="re-assign / fresh leads" />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Approved commission" value={inr(data?.commissionSummary?.approvedCommission ?? 0)} tone="success" />
        <Stat label="Pending commission" value={inr(data?.commissionSummary?.pendingCommission ?? 0)} tone="warn" />
        <Stat label="Payouts awaiting" value={inr(data?.pendingPayout?.total ?? 0)} tone="info" />
      </div>

      <Tabs defaultValue="deals">
        <TabsList>
          <TabsTrigger value="deals">Deals ({counts.deals})</TabsTrigger>
          <TabsTrigger value="payouts">Payouts ({counts.withdrawals})</TabsTrigger>
          <TabsTrigger value="corrections">Corrections ({counts.corrections})</TabsTrigger>
          <TabsTrigger value="requests">Lead requests ({counts.leadRequests})</TabsTrigger>
          <TabsTrigger value="replaces">Replace leads ({data?.replaces?.filter((r) => r.status === "PENDING").length ?? 0})</TabsTrigger>
          <TabsTrigger value="history">History access ({data?.historyAccess?.filter((r) => r.status === "PENDING").length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="deals">
          {/* Pending / Approved / Rejected scope */}
          <div className="mb-2 flex gap-1.5">
            {(["PENDING", "APPROVED", "REJECTED"] as const).map((sc) => (
              <button
                key={sc}
                onClick={() => setDealScope(sc)}
                className={cn(
                  "flex-1 rounded-full border px-3 py-2 text-xs font-semibold transition sm:flex-none",
                  dealScope === sc ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600",
                )}
              >
                {sc === "APPROVED" ? "Approved" : sc === "REJECTED" ? "Rejected" : "Pending"}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            {(data?.deals ?? []).length === 0 ? <EmptyState title="No deal submissions" hint="Agents submit payment screenshots with status 'Payment Approval Pending'." icon="🧾" /> : null}
            {(data?.deals ?? []).map((d) => (
              <div key={d.id} className="rounded-xl border bg-white p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold">
                      {d.businessName} <span className="text-xs text-muted-foreground">#{d.leadId}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {d.agentName} · {d.city ?? "—"} · {timeAgo(d.createdAt)}
                    </p>
                    <p className="mt-1 text-xs">
                      Deal <strong>{inr(d.amount)}</strong> → commission <strong className="text-emerald-700">{inr(d.commission)}</strong>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <OpenLeadButton leadId={d.leadId} leadCode={`#${d.leadId}`} isStaff={true} />
                    <Badge variant={d.status === "APPROVED" ? "success" : d.status === "PENDING" ? "warn" : "danger"}>{d.status}</Badge>
                    {d.agentPhone ? (
                      <a href={waLink(d.agentPhone, `Deal verification for ${d.businessName} (#${d.leadId})`)} target="_blank" rel="noreferrer" className="text-xs text-emerald-600 underline">
                        WhatsApp agent
                      </a>
                    ) : null}
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {d.proofUrl ? (
                    <button
                      onClick={() => {
                        setScale(1);
                        setZoom({ url: d.proofUrl!, label: `${d.businessName} · ${inr(d.amount)}`, note: d.agentNote });
                      }}
                      className="flex items-center gap-2 rounded-lg border p-1 text-[11px] text-blue-700"
                    >
                      <Eye className="h-3.5 w-3.5 shrink-0" />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <SafeImage src={d.proofUrl} alt="Payment proof" className="h-12 w-12 rounded object-cover" />
                      <span className="underline decoration-dotted">inspect &amp; zoom</span>
                    </button>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">No screenshot attached</span>
                  )}
                  {d.agentNote ? (
                    <p className="mt-1 w-full rounded bg-slate-50 p-1.5 text-[11px] text-slate-700">
                      <span className="font-semibold">Agent note:</span> {d.agentNote}
                    </p>
                  ) : null}
                </div>

                {d.status === "PENDING" ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Input
                      placeholder="Review note (optional)"
                      value={notes[`deal-${d.id}`] ?? ""}
                      onChange={(e) => setNotes({ ...notes, [`deal-${d.id}`]: e.target.value })}
                      className="h-11 w-full min-w-0 flex-1 sm:h-9"
                    />
                    <Button size="sm" variant="success" disabled={busy === `deal-${d.id}`} onClick={() => void decide("deal", d.id, "APPROVE")}>
                      <CheckCircle2 className="h-4 w-4" /> Approve &amp; credit
                    </Button>
                    <Button size="sm" variant="destructive" disabled={busy === `deal-${d.id}`} onClick={() => void decide("deal", d.id, "REJECT")}>
                      <XCircle className="h-4 w-4" /> Reject
                    </Button>
                    <p className="w-full text-[10px] text-muted-foreground">
                      Rejection reason is required — the agent sees it and gets a “Re-upload Proof” button.
                    </p>
                  </div>
                ) : (
                  <div className="mt-2 space-y-1.5">
                    {d.status === "REJECTED" ? (
                      <div className="rounded-lg border border-rose-200 bg-rose-50 p-2">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-rose-800">Rejection reason</p>
                        <p className="text-[11px] text-rose-700">{d.rejectionReason ?? d.reviewNote ?? "No reason recorded."}</p>
                      </div>
                    ) : null}
                    <p className="text-[11px] text-muted-foreground">
                      {d.reviewNote ?? "Reviewed"} · {d.decidedAt ? dateTime(d.decidedAt) : ""}
                    </p>
                    {/* Re-Submit / Re-Approve path for rejected deals */}
                    {d.status === "REJECTED" ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          placeholder="Re-approve note (optional)"
                          value={notes[`deal-re-${d.id}`] ?? ""}
                          onChange={(e) => setNotes({ ...notes, [`deal-re-${d.id}`]: e.target.value })}
                          className="h-11 w-full min-w-0 flex-1 sm:h-9"
                        />
                        <Button size="sm" variant="success" onClick={() => void reApprove(d.id)}>
                          <CheckCircle2 className="h-4 w-4" /> Re-Approve
                        </Button>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="payouts">
          <div className="space-y-2">
            {(data?.withdrawals ?? []).length === 0 ? <EmptyState title="No payout requests" hint="Agents request wallet withdrawals from their earnings page." icon="🏦" /> : null}
            {(data?.withdrawals ?? []).map((w) => (
              <div key={w.id} className="rounded-xl border bg-white p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold">
                      {w.agentName} · {inr(w.amount)}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {w.method} → {w.destination ?? "—"} · {timeAgo(w.createdAt)}
                    </p>
                  </div>
                  <Badge variant={w.status === "APPROVED" ? "success" : w.status === "PENDING" ? "warn" : "danger"}>{w.status}</Badge>
                </div>
                {w.proofUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <SafeImage src={w.proofUrl} alt="Payout proof" className="mt-2 h-16 w-16 rounded-lg border object-cover" />
                ) : null}
                {w.status === "PENDING" ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Input
                      placeholder="UTR / payment reference"
                      value={notes[`withdrawal-${w.id}`] ?? ""}
                      onChange={(e) => setNotes({ ...notes, [`withdrawal-${w.id}`]: e.target.value })}
                      className="h-11 w-full min-w-0 flex-1 sm:h-9"
                    />
                    <Button size="sm" variant="success" onClick={() => void decide("withdrawal", w.id, "APPROVE")}>
                      <HandCoins className="h-4 w-4" /> Mark paid
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => void decide("withdrawal", w.id, "REJECT")}>
                      <XCircle className="h-4 w-4" /> Reject
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="corrections">
          <div className="space-y-2">
            {(data?.corrections ?? []).length === 0 ? <EmptyState title="No correction requests" hint="Agents raise these with the 'Any mistake happen?' button." icon="🛠️" /> : null}
            {(data?.corrections ?? []).map((c) => (
              <div key={c.id} className="rounded-xl border bg-white p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold">
                      {c.businessName} <span className="text-xs text-muted-foreground">#{c.leadId}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {c.agentName} · {timeAgo(c.createdAt)}
                    </p>
                    <p className="mt-1 rounded-lg bg-slate-50 p-2 text-xs">“{c.reason}”</p>
                    {c.requestedStatus ? <Badge variant="muted" className="mt-1">wants → {c.requestedStatus}</Badge> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <OpenLeadButton leadId={c.leadId} leadCode={`#${c.leadId}`} isStaff={true} />
                    <Badge variant={c.status === "PENDING" ? "warn" : c.status === "APPROVED" ? "success" : "danger"}>{c.status}</Badge>
                  </div>
                </div>
                {c.status === "PENDING" ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Input
                      placeholder="Resolver note"
                      value={notes[`correction-${c.id}`] ?? ""}
                      onChange={(e) => setNotes({ ...notes, [`correction-${c.id}`]: e.target.value })}
                      className="h-11 w-full min-w-0 flex-1 sm:h-9"
                    />
                    <Button size="sm" variant="success" onClick={() => void decide("correction", c.id, "APPROVE")}>
                      <BadgeCheck className="h-4 w-4" /> Approve &amp; unlock
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => void decide("correction", c.id, "REJECT")}>
                      <XCircle className="h-4 w-4" /> Reject
                    </Button>
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] text-muted-foreground">{c.resolvedNote ?? "Reviewed"}</p>
                )}
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="requests">
          <div className="space-y-2">
            {(data?.leadRequests ?? []).length === 0 ? <EmptyState title="No lead requests" hint="Agents who finish their daily list request more leads here." icon="📋" /> : null}
            {(data?.leadRequests ?? []).map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-white p-3">
                <div>
                  <p className="text-sm font-bold">
                    {r.agentName} wants {r.quantity} leads
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {r.nicheName ?? "Any niche"} · {r.note ?? "no note"} · {timeAgo(r.createdAt)}
                  </p>
                </div>
                {r.status === "PENDING" ? (
                  <div className="flex gap-2">
                    <Button size="sm" variant="success" onClick={() => void decide("leadRequest", r.id, "APPROVE")}>
                      <CheckCircle2 className="h-4 w-4" /> Assign
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => void decide("leadRequest", r.id, "REJECT")}>
                      <XCircle className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <Badge variant={r.status === "APPROVED" ? "success" : "danger"}>{r.status}</Badge>
                )}
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="replaces">
          <div className="space-y-2">
            {(data?.replaces ?? []).length === 0 ? <EmptyState title="No replacement requests" hint="Agents file these with “Request Replace Lead”." icon="🔁" /> : null}
            {(data?.replaces ?? []).map((r) => (
              <div key={r.id} className="rounded-xl border bg-white p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-bold">
                      {r.businessName ?? "—"} <span className="text-xs text-muted-foreground">#{r.leadId ?? "—"} · {r.leadCode ?? ""}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {r.agentName} · {r.nicheName ?? "—"} · stage {r.leadStatus?.replace("_", " ") ?? "—"} · {timeAgo(r.createdAt)}
                    </p>
                    <p className="mt-1 rounded-lg bg-slate-50 p-2 text-xs">
                      <span className="font-semibold">Reason:</span> {r.reason ?? r.note ?? "—"}
                    </p>
                  </div>
                  <Badge variant={r.status === "PENDING" ? "warn" : r.status === "APPROVED" ? "success" : "danger"}>{r.status}</Badge>
                </div>
                {r.status === "PENDING" ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Input
                      placeholder="Reviewer note (optional)"
                      value={notes[`replace-${r.id}`] ?? ""}
                      onChange={(e) => setNotes({ ...notes, [`replace-${r.id}`]: e.target.value })}
                      className="h-11 w-full min-w-0 flex-1 sm:h-9"
                    />
                    <Button size="sm" variant="success" disabled={busy === `replace-${r.id}`} onClick={() => void decideReplace(r.id, "APPROVE")}>
                      <CheckCircle2 className="h-4 w-4" /> Approve &amp; replace
                    </Button>
                    <Button size="sm" variant="destructive" disabled={busy === `replace-${r.id}`} onClick={() => void decideReplace(r.id, "REJECT")}>
                      <XCircle className="h-4 w-4" /> Reject
                    </Button>
                  </div>
                ) : (
                  <p className="mt-2 text-[11px] text-muted-foreground">{r.resolvedNote ?? "Reviewed"}</p>
                )}
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="history">
          <div className="space-y-2">
            {(data?.historyAccess ?? []).length === 0 ? <EmptyState title="No history access requests" hint="Agents request past call notes when history is hidden." icon="🕵️" /> : null}
            {(data?.historyAccess ?? []).map((h) => (
              <div key={h.id} className="flex flex-wrap items-start justify-between gap-2 rounded-xl border bg-white p-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold">
                    {h.businessName ?? "—"} <span className="text-xs text-muted-foreground">#{h.leadId} · {h.leadCode ?? ""}</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {h.agentName} · {timeAgo(h.createdAt)}
                  </p>
                  {h.reason ? <p className="mt-1 rounded-lg bg-slate-50 p-2 text-xs">{h.reason}</p> : null}
                </div>
                {h.status === "PENDING" ? (
                  <div className="flex gap-2">
                    <Button size="sm" variant="success" onClick={() => void decideHistory(h.id, "APPROVE")}>
                      <CheckCircle2 className="h-4 w-4" /> Grant
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => void decideHistory(h.id, "REJECT")}>
                      <XCircle className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <Badge variant={h.status === "APPROVED" ? "success" : "danger"}>{h.status}</Badge>
                )}
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      {/* proof zoom review */}
      <Sheet open={Boolean(zoom)} onOpenChange={(v) => !v && setZoom(null)} title="Payment proof review" description={zoom?.label}>
        <div className="space-y-3">
          {zoom?.note ? <p className="rounded-lg bg-slate-50 p-2 text-xs">{zoom.note}</p> : null}
          <div className="overflow-auto rounded-xl border bg-slate-50 p-2 thin-scroll">
            {zoom ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={zoom.url} alt={zoom.label} style={{ transform: `scale(${scale})` }} className="mx-auto origin-top transition-transform" />
            ) : null}
          </div>
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setScale((z) => Math.max(0.5, z - 0.25))}>
              −
            </Button>
            <span className="w-14 text-center text-xs">{Math.round(scale * 100)}%</span>
            <Button variant="outline" size="sm" onClick={() => setScale((z) => Math.min(3, z + 0.25))}>
              +
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setScale(1)}>
              Reset
            </Button>
          </div>
          {zoom ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Input
                placeholder="Rejection reason (required to reject)"
                value={notes[`zoom-${zoom.url}`] ?? ""}
                onChange={(e) => setNotes({ ...notes, [`zoom-${zoom.url}`]: e.target.value })}
                className="h-11 sm:h-9"
              />
              <p className="self-center text-[10px] text-muted-foreground">
                Close this sheet and use Reject on the deal card — the reason box there is stored and shown to the agent.
              </p>
            </div>
          ) : null}
        </div>
      </Sheet>

      <Button variant="outline" className="w-full" onClick={() => void load()}>
        <RefreshCcw className="h-4 w-4" /> Refresh queue
      </Button>
    </div>
  );
}
