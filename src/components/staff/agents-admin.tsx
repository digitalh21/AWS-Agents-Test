"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Plus, RefreshCcw, ShieldCheck, UserPlus, XCircle } from "lucide-react";
import { toast } from "sonner";
import { SafeImage } from "@/components/shared/safe-image";
import { Button } from "@/components/ui/button";
import { Badge, DesktopTable, Input, Label, MobileList, NativeSelect, Stat, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/dialog";
import { hms, inr, num, timeAgo } from "@/lib/utils";

type Row = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  isActive: boolean;
  isOnline: boolean;
  lastSeenAt: string | null;
  activeSeconds: number;
  nicheName: string | null;
  nicheId: number | null;
  kycStatus: string;
  kycAadhaarUrl: string | null;
  kycMarksheetUrl: string | null;
  kycPhotoUrl: string | null;
  kycPanUrl: string | null;
  walletTotal: string;
  walletPending: string;
  walletApproved: string;
  commissionPerDeal: string;
  upiId: string | null;
  bankName: string | null;
  leadCount: number;
  closedCount: number;
  calls: number;
  talkSeconds: number;
};

export function AgentsAdmin() {
  const [rows, setRows] = useState<Row[]>([]);
  const [niches, setNiches] = useState<Array<{ id: number; name: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [kycRow, setKycRow] = useState<Row | null>(null);
  const [kycReason, setKycReason] = useState("");
  const [kycBusy, setKycBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", phone: "", role: "AGENT", primaryNicheId: 0, commissionPerDeal: 500, password: "password123" });

  const load = useCallback(async () => {
    const res = await fetch("/api/agents");
    if (res.ok) {
      const json = (await res.json()) as { rows: Row[]; niches: Array<{ id: number; name: string }> };
      setRows(json.rows);
      setNiches(json.niches);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Approve or reject KYC with a mandatory rejection reason (fires an agent popup). */
  async function reviewKyc(userId: string, status: "APPROVED" | "REJECTED") {
    if (status === "REJECTED" && kycReason.trim().length < 5) {
      toast.error("A rejection reason (min 5 characters) is required — the agent will see it.");
      return;
    }
    setKycBusy(true);
    const res = await fetch("/api/agent/kyc", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, status, reason: kycReason.trim() || undefined }),
    });
    const json = (await res.json()) as { error?: string };
    if (res.ok) {
      toast.success(status === "APPROVED" ? "KYC approved — agent notified" : "KYC rejected — agent notified");
      setKycRow(null);
      setKycReason("");
      await load();
    } else toast.error(json.error ?? "Action failed");
    setKycBusy(false);
  }

  /** Management "Switch as User" — swaps the session to this agent (audited). */
  async function switchAsUser(userId: string, name: string) {
    setBusy(true);
    const res = await fetch("/api/auth/impersonate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    const json = (await res.json()) as { error?: string; redirect?: string };
    if (res.ok) {
      toast.success(`Now previewing as ${name} — use the amber bar to switch back`);
      window.location.href = json.redirect ?? "/dashboard";
    } else {
      toast.error(json.error ?? "Could not switch user");
      setBusy(false);
    }
  }

  async function patch(userId: string, body: Record<string, unknown>) {
    setBusy(true);
    const res = await fetch("/api/agents", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, ...body }),
    });
    if (res.ok) {
      toast.success("Agent updated");
      await load();
    } else toast.error("Update failed");
    setBusy(false);
  }

  const agents = rows.filter((r) => r.role === "AGENT");
  const onlineAgents = agents.filter((a) => a.isOnline);
  const pendingKyc = agents.filter((a) => a.kycStatus !== "APPROVED");

  const nicheSelect = (r: Row, compact = false) => (
    <NativeSelect
      value={r.nicheId ?? 0}
      onChange={(e) => void patch(r.id, { primaryNicheId: Number(e.target.value) })}
      className={compact ? "h-9 text-[11px]" : "h-7 w-32 text-[11px]"}
      aria-label="Niche"
    >
      <option value={0}>All</option>
      {niches.map((n) => (
        <option key={n.id} value={n.id}>
          {n.name}
        </option>
      ))}
    </NativeSelect>
  );

  return (
    <div className="space-y-3 p-3 sm:p-4 lg:p-6">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Agents" value={num(agents.length)} hint={`${onlineAgents.length} online now`} />
        <Stat label="KYC pending" value={num(pendingKyc.length)} tone="warn" hint="HR verification" />
        <Stat label="Commission payable" value={inr(agents.reduce((s, a) => s + Number(a.walletPending), 0))} tone="info" />
        <Stat label="Total paid out" value={inr(agents.reduce((s, a) => s + Number(a.walletApproved), 0))} tone="success" />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-white p-2 sm:p-3">
        <p className="mr-auto hidden text-[11px] font-bold uppercase tracking-wide text-muted-foreground sm:block">
          Team management
        </p>
        <Button
          size="sm"
          className="flex-1 border-emerald-600 bg-emerald-600 hover:bg-emerald-700 sm:flex-none"
          onClick={() => setCreateOpen(true)}
        >
          <UserPlus className="h-4 w-4" /> Add Manual Agent
        </Button>
        <Button size="sm" variant="outline" className="flex-1 sm:flex-none" onClick={() => void load()}>
          <RefreshCcw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <p className="text-sm font-semibold">No agents yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Use “Add Manual Agent” to create your first team member.</p>
        </div>
      ) : null}

      {/* desktop table */}
      <DesktopTable>
        <table className="w-full min-w-[1000px] text-left text-xs">
          <thead className="border-b bg-slate-50 text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-2">Agent</th>
              <th className="p-2">Niche</th>
              <th className="p-2">Leads</th>
              <th className="p-2">Closed</th>
              <th className="p-2">Calls</th>
              <th className="p-2">Active time</th>
              <th className="p-2">Wallet (pending / paid)</th>
              <th className="p-2">KYC</th>
              <th className="p-2">Status</th>
              <th className="p-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="p-2">
                  <p className="font-semibold">{r.name}</p>
                  <p className="text-[10px] text-muted-foreground">{r.email}</p>
                  <p className="text-[10px] text-muted-foreground">{r.upiId ?? r.bankName ?? "no payout detail"}</p>
                </td>
                <td className="p-2">{nicheSelect(r)}</td>
                <td className="p-2 tabular-nums">{num(r.leadCount)}</td>
                <td className="p-2 tabular-nums text-emerald-700">{num(r.closedCount)}</td>
                <td className="p-2 tabular-nums">
                  {num(r.calls)}
                  <span className="block text-[10px] text-muted-foreground">{Math.round(r.talkSeconds / 60)}m talk</span>
                </td>
                <td className="p-2 tabular-nums">{hms(r.activeSeconds)}</td>
                <td className="p-2 tabular-nums">
                  {inr(r.walletPending)} <span className="text-muted-foreground">/ {inr(r.walletApproved)}</span>
                </td>
                <td className="p-2">
                  <button onClick={() => setKycRow(r)} className="flex items-center gap-1 text-[11px]">
                    <Badge variant={r.kycStatus === "APPROVED" ? "success" : r.kycStatus === "UNDER_REVIEW" ? "warn" : "danger"}>{r.kycStatus}</Badge>
                    <span className="text-blue-600 underline">review</span>
                  </button>
                </td>
                <td className="p-2">
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => void patch(r.id, { isActive: !r.isActive })}
                      className={r.isActive ? "text-[10px] font-semibold text-emerald-700" : "text-[10px] font-semibold text-rose-600"}
                    >
                      {r.isActive ? "● active" : "○ disabled"}
                    </button>
                    <span className="text-[10px] text-muted-foreground">seen {timeAgo(r.lastSeenAt)}</span>
                  </div>
                </td>
                <td className="p-2 text-right">
                  <div className="inline-flex items-center gap-1">
                    {r.role === "AGENT" ? (
                      <Button size="xs" variant="outline" className="border-amber-300 bg-amber-50 text-amber-800" disabled={busy} onClick={() => void switchAsUser(r.id, r.name)}>
                        Switch as User
                      </Button>
                    ) : null}
                    <Button size="xs" variant="outline" disabled={busy} onClick={() => void patch(r.id, { walletAdjust: 500 })}>
                      +₹500
                    </Button>
                    <Button size="xs" variant="ghost" disabled={busy} onClick={() => void patch(r.id, { walletAdjust: -500 })}>
                      −₹500
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DesktopTable>

      {/* mobile cards */}
      <MobileList>
        {rows.map((r) => (
          <div key={r.id} className="rounded-xl border bg-white p-3 shadow-sm">
            <div className="flex items-start gap-2.5">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">
                {r.name.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-bold">{r.name}</p>
                  {r.isOnline ? <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 live-dot" /> : null}
                </div>
                <p className="truncate text-[11px] text-muted-foreground">{r.email}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Badge variant="muted">{r.role}</Badge>
                  <Badge variant={r.isActive ? "success" : "danger"}>{r.isActive ? "active" : "disabled"}</Badge>
                  <span className="text-[10px] text-muted-foreground">seen {timeAgo(r.lastSeenAt)}</span>
                </div>
              </div>
            </div>

            <div className="mt-2 grid grid-cols-3 gap-1.5 text-center text-[11px]">
              <div className="rounded-lg bg-slate-50 p-1.5">
                <p className="text-[9px] uppercase text-muted-foreground">Leads</p>
                <p className="font-bold tabular-nums">{num(r.leadCount)}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-1.5">
                <p className="text-[9px] uppercase text-muted-foreground">Closed</p>
                <p className="font-bold tabular-nums text-emerald-700">{num(r.closedCount)}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-1.5">
                <p className="text-[9px] uppercase text-muted-foreground">Calls</p>
                <p className="font-bold tabular-nums">{num(r.calls)}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-1.5">
                <p className="text-[9px] uppercase text-muted-foreground">Active</p>
                <p className="font-bold tabular-nums">{hms(r.activeSeconds)}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-1.5">
                <p className="text-[9px] uppercase text-muted-foreground">Pending</p>
                <p className="font-bold tabular-nums">{inr(r.walletPending)}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-1.5">
                <p className="text-[9px] uppercase text-muted-foreground">Paid</p>
                <p className="font-bold tabular-nums">{inr(r.walletApproved)}</p>
              </div>
            </div>

            <div className="mt-2 space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Niche</p>
              {nicheSelect(r, true)}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Button size="xs" variant="outline" onClick={() => setKycRow(r)}>
                KYC <Badge variant={r.kycStatus === "APPROVED" ? "success" : r.kycStatus === "UNDER_REVIEW" ? "warn" : "danger"}>{r.kycStatus}</Badge>
              </Button>
              <Button size="xs" variant="secondary" onClick={() => window.open(`/agents/${r.id}`, "_self")}>
                Profile
              </Button>
              {r.role === "AGENT" ? (
                <Button size="xs" variant="outline" className="border-amber-300 bg-amber-50 text-amber-800" disabled={busy} onClick={() => void switchAsUser(r.id, r.name)}>
                  Switch as User
                </Button>
              ) : null}
              <Button size="xs" variant="outline" disabled={busy} onClick={() => void patch(r.id, { walletAdjust: 500 })}>
                +₹500
              </Button>
              <Button size="xs" variant="ghost" disabled={busy} onClick={() => void patch(r.id, { walletAdjust: -500 })}>
                −₹500
              </Button>
              <Button size="xs" variant={r.isActive ? "destructive" : "success"} className="ml-auto" disabled={busy} onClick={() => void patch(r.id, { isActive: !r.isActive })}>
                {r.isActive ? "Disable" : "Enable"}
              </Button>
            </div>
          </div>
        ))}
      </MobileList>

      {/* KYC review */}
      <Sheet open={Boolean(kycRow)} onOpenChange={(v) => !v && setKycRow(null)} title={kycRow ? `KYC · ${kycRow.name}` : "KYC"} description="HR verification of uploaded documents">
        {kycRow ? (
          <div className="space-y-3">
            {[
              { label: "Aadhaar", url: kycRow.kycAadhaarUrl },
              { label: "10th Marksheet", url: kycRow.kycMarksheetUrl },
              { label: "Passport photo", url: kycRow.kycPhotoUrl },
              { label: "PAN", url: kycRow.kycPanUrl },
            ].map((doc) => (
              <div key={doc.label} className="rounded-xl border p-2">
                <p className="text-xs font-semibold">{doc.label}</p>
                {doc.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <SafeImage src={doc.url} alt={doc.label} className="mt-1 max-h-48 w-full rounded-lg bg-slate-100 object-contain" />
                ) : (
                  <p className="mt-1 text-[11px] text-muted-foreground">Not uploaded</p>
                )}
              </div>
            ))}
            <div className="space-y-1.5 rounded-xl border border-amber-200 bg-amber-50 p-2.5">
              <Label>Rejection reason (required only when rejecting)</Label>
              <Textarea
                value={kycReason}
                onChange={(e) => setKycReason(e.target.value)}
                placeholder="Aadhaar photo is blurred — please re-upload a clear, well-lit image."
                className="min-h-[70px] border-amber-200 bg-white"
              />
              <p className="text-[10px] text-amber-800">
                The reason is shown to the agent in a popup, and their profile unlocks a “Re-upload &amp; Re-submit KYC” option.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button className="w-full sm:flex-1" variant="success" disabled={kycBusy} onClick={() => void reviewKyc(kycRow.id, "APPROVED")}>
                <CheckCircle2 className="h-4 w-4" /> Approve KYC
              </Button>
              <Button className="w-full sm:flex-1" variant="destructive" disabled={kycBusy} onClick={() => void reviewKyc(kycRow.id, "REJECTED")}>
                <XCircle className="h-4 w-4" /> Reject KYC
              </Button>
            </div>
          </div>
        ) : null}
      </Sheet>

      {/* create user */}
      <Sheet open={createOpen} onOpenChange={setCreateOpen} title="Add agent or staff" description="Default password: password123">
        <div className="space-y-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Full name</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input type="email" inputMode="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Role</Label>
              <NativeSelect value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                <option value="AGENT">Agent</option>
                <option value="MANAGER">Manager</option>
                <option value="HR">HR</option>
                <option value="ADMIN">Admin</option>
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label>Niche</Label>
              <NativeSelect value={form.primaryNicheId} onChange={(e) => setForm({ ...form, primaryNicheId: Number(e.target.value) })}>
                <option value={0}>All niches</option>
                {niches.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-1">
              <Label>Commission / deal (₹)</Label>
              <Input inputMode="numeric" value={form.commissionPerDeal} onChange={(e) => setForm({ ...form, commissionPerDeal: Number(e.target.value) })} />
            </div>
          </div>
          <Button
            className="w-full"
            disabled={busy || !form.name || !form.email}
            onClick={async () => {
              setBusy(true);
              const res = await fetch("/api/agents", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(form),
              });
              const json = (await res.json()) as { error?: string };
              if (res.ok) {
                toast.success("User created");
                setCreateOpen(false);
                setForm({ ...form, name: "", email: "", phone: "" });
                await load();
              } else toast.error(json.error ?? "Could not create");
              setBusy(false);
            }}
          >
            <Plus className="h-4 w-4" /> Create user
          </Button>
          <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <ShieldCheck className="h-3 w-3" /> Agents never receive delete permissions anywhere in the system.
          </p>
        </div>
      </Sheet>
    </div>
  );
}
