"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Award,
  BadgeCheck,
  CalendarDays,
  Camera,
  CheckCircle2,
  Clock,
  GraduationCap,
  IdCard,
  IndianRupee,
  Loader2,
  Lock,
  Phone,
  Save,
  ShieldAlert,
  ShieldCheck,
  Trophy,
  Unlock,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { SafeImage } from "@/components/shared/safe-image";
import { LiveActivityCounter } from "@/components/agent/live-activity-counter";
import { useInteraction } from "@/components/shared/security-guard";
import { Button } from "@/components/ui/button";
import { Badge, Input, Label, NativeSelect, SectionCard, Stat, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/dialog";
import { uploadFile } from "@/components/shared/upload-file";
import { cn, dateTime, hms, inr, num, timeAgo } from "@/lib/utils";
import { STATUS_META } from "@/lib/rbac";

type Profile = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  altPhone: string | null;
  guardianPhone: string | null;
  role: string;
  avatarUrl: string | null;
  qualification: string | null;
  aboutPerson: string | null;
  badges: string[] | null;
  walletTotal: string;
  walletPending: string;
  walletApproved: string;
  commissionPerDeal: string;
  bankName: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  upiId: string | null;
  payoutLocked: boolean;
  kycStatus: string;
  kycAadhaarUrl: string | null;
  kycMarksheetUrl: string | null;
  kycPhotoUrl: string | null;
  kycPanUrl: string | null;
  activeSeconds: number;
  nicheName: string | null;
  isOnline: boolean;
  createdAt: string;
};

type Payload = {
  profile: Profile;
  viewer: { id: string; role: string; isSelf: boolean; canManage: boolean };
  payoutLocked: boolean;
  kycDocuments: Array<{ id: number; kind: string; fileName: string | null; url: string; uploadedAt: string }>;
  dailyActivity: Array<{
    day: string;
    activeSeconds: number;
    touchedLeads: number;
    statusChanges: number;
    dealsClosed: number;
    callsMade: number;
  }>;
  activityToday: { activeSeconds: number; touchedLeads: number; statusChanges: number; dealsClosed: number; callsMade: number };
  activityTotals: { activeSeconds: number; touchedLeads: number; statusChanges: number; dealsClosed: number; callsMade: number; days: number };
  pipeline: Array<{ status: string; value: number }>;
  commission?: { closes: number; amount: number; slab: { label: string } | null; nextSlab: { label: string; minCloses: number } | null };
};

const QUALIFICATIONS = ["10th", "12th", "Diploma", "Graduate", "Post Graduate", "Professional"];
const BADGE_OPTIONS = ["Star Caller", "Top Closer", "Consistent Performer", "Fast Starter", "Century Club", "Quality Champion"];

export function AgentProfileView({ targetUserId }: { targetUserId?: string }) {
  const interaction = useInteraction();
  const [data, setData] = useState<Payload | null>(null);
  const [form, setForm] = useState({
    bankName: "",
    bankAccount: "",
    bankIfsc: "",
    upiId: "",
    phone: "",
    altPhone: "",
    guardianPhone: "",
    qualification: "",
  });
  const [about, setAbout] = useState("");
  const [badges, setBadges] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null);
  const kycInput = useRef<HTMLInputElement | null>(null);
  const marksheetInput = useRef<HTMLInputElement | null>(null);
  const kycKind = useRef<string>("AADHAAR");
  const [idOpen, setIdOpen] = useState(false);
  // KYC rejection handling — reason comes from the decision notice
  const [kycReject, setKycReject] = useState<{ reason: string; at: string; by: string } | null>(null);
  const [resubmitKind, setResubmitKind] = useState<string>("AADHAAR");
  const resubmitRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    const q = targetUserId ? `?userId=${targetUserId}&include=earnings` : "?include=earnings";
    const res = await fetch(`/api/agent/profile${q}`);
    if (!res.ok) return;
    const json = (await res.json()) as Payload;
    setData(json);
    setForm({
      bankName: json.profile.bankName ?? "",
      bankAccount: json.profile.bankAccount ?? "",
      bankIfsc: json.profile.bankIfsc ?? "",
      upiId: json.profile.upiId ?? "",
      phone: json.profile.phone ?? "",
      altPhone: json.profile.altPhone ?? "",
      guardianPhone: json.profile.guardianPhone ?? "",
      qualification: json.profile.qualification ?? "",
    });
    setAbout(json.profile.aboutPerson ?? "");
    setBadges(json.profile.badges ?? []);

    // latest KYC rejection notice drives the re-submit banner
    if (!targetUserId || targetUserId === json.viewer.id) {
      try {
        const d = await fetch("/api/decision-notices");
        if (d.ok) {
          const dj = (await d.json()) as {
            history: Array<{ kind: string; status: string; notes: string | null; createdAt: string; actorName: string | null }>;
          };
          const lastKycRej = (dj.history ?? []).find((h) => h.kind === "KYC" && h.status === "REJECTED");
          setKycReject(
            lastKycRej
              ? { reason: lastKycRej.notes ?? "No reason recorded.", at: lastKycRej.createdAt, by: lastKycRej.actorName ?? "Management" }
              : null,
          );
        }
      } catch {
        /* optional */
      }
    }
  }, [targetUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    const res = await fetch("/api/agent/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(targetUserId ? { ...body, userId: targetUserId } : body),
    });
    const json = (await res.json()) as { error?: string };
    if (res.ok) {
      toast.success("Saved");
      await load();
    } else toast.error(json.error ?? "Save failed");
    setBusy(false);
    return res.ok;
  }

  /** Re-upload & re-submit a rejected KYC document (agent-initiated). */
  async function resubmitKyc(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", resubmitKind);
    const up = await fetch("/api/upload", { method: "POST", body: fd });
    const uj = (await up.json()) as { url?: string; id?: number; error?: string };
    if (!up.ok || !uj.url) {
      toast.error(uj.error ?? "Upload failed");
      return;
    }
    const res = await fetch("/api/agent/kyc", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resubmit: true,
        url: uj.url,
        fileName: file.name,
        level: resubmitKind,
        userId: targetUserId,
      }),
    });
    if (res.ok) {
      toast.success("KYC re-submitted — pending management review");
      setKycReject(null);
      await load();
    } else toast.error("Could not re-submit");
  }

  async function uploadDoc(file: File, kind: string) {
    // Resilient: B2 on the server, inline base64 preview if it fails.
    const result = await uploadFile(file, { kind, silent: true });
    const url = result.url || result.dataUrl;
    if (!url) {
      toast.error(result.error ?? "Upload failed");
      return null;
    }
    if (!result.ok) toast.warning("Saved as a local preview only — retry to store it.");

    // store as a KYC document row (marksheets allow up to 5)
    await fetch("/api/agent/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, url, fileName: file.name, uploadId: result.id, userId: targetUserId }),
    });
    if (kind === "PHOTO") await patch({ kycPhotoUrl: url, avatarUrl: url });
    else if (kind === "AADHAAR") await patch({ kycAadhaarUrl: url });
    else if (kind === "PAN") await patch({ kycPanUrl: url });
    else if (kind === "MARKSHEET") await patch({ kycMarksheetUrl: url });
    await load();
    return url;
  }

  const locked = data?.payoutLocked ?? false;
  const marksheets = (data?.kycDocuments ?? []).filter((d) => d.kind === "MARKSHEET");
  const pipelineMap = Object.fromEntries((data?.pipeline ?? []).map((p) => [p.status, p.value]));

  /** Rank derived from approved closes so it always matches the ledger. */
  const closes = data?.commission?.closes ?? 0;
  const rank = (() => {
    if (closes >= 100) return { rank: 1, label: "Century Club · Top Closer" };
    if (closes >= 50) return { rank: 2, label: "Diamond Closer" };
    if (closes >= 31) return { rank: 3, label: "Gold Closer" };
    if (closes >= 16) return { rank: 4, label: "Silver Closer" };
    if (closes >= 1) return { rank: 5, label: "Rising Caller" };
    return null;
  })();
  const totalPipeline = Object.values(pipelineMap).reduce((a, b) => a + b, 0);

  if (!data) {
    return (
      <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading profile…
      </div>
    );
  }

  return (
    <div className="space-y-3 p-3 sm:p-4 lg:p-6">
      {/* ---------- header ---------- */}
      <div className="rounded-xl border bg-white p-4">
        <div className="flex flex-wrap items-start gap-3">
          {data.profile.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <SafeImage src={data.profile.avatarUrl} alt={data.profile.name} className="h-16 w-16 shrink-0 rounded-2xl object-cover" />
          ) : (
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-lg font-bold text-white">
              {data.profile.name.slice(0, 2).toUpperCase()}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="truncate text-base font-bold">{data.profile.name}</p>
              {data.profile.isOnline ? <span className="h-2 w-2 rounded-full bg-emerald-500 live-dot" /> : null}
            </div>
            <p className="truncate text-xs text-muted-foreground">{data.profile.email}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <Badge variant="muted">{data.profile.role}</Badge>
              <Badge variant="outline">{data.profile.nicheName ?? "All niches"}</Badge>
              <Badge variant={data.profile.kycStatus === "APPROVED" ? "success" : data.profile.kycStatus === "UNDER_REVIEW" ? "warn" : "danger"}>
                KYC {data.profile.kycStatus}
              </Badge>
              {locked ? (
                <Badge variant="success">
                  <Lock className="h-2.5 w-2.5" /> payout locked
                </Badge>
              ) : (
                <Badge variant="warn">
                  <Unlock className="h-2.5 w-2.5" /> payout editable
                </Badge>
              )}
            </div>
            {(data.profile.badges ?? []).length ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {(data.profile.badges ?? []).map((b) => (
                  <span key={b} className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">
                    🏅 {b}
                  </span>
                ))}
              </div>
            ) : null}
            {rank ? (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700">
                  <Trophy className="h-3 w-3" /> Rank #{rank.rank} {rank.label}
                </span>
              </div>
            ) : null}
          </div>
        </div>
        {data.profile.aboutPerson ? (
          <p className="mt-3 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-700">
            <span className="font-semibold">About: </span>
            {data.profile.aboutPerson}
          </p>
        ) : null}
      </div>

      {/* ---------- commission per close indicator ---------- */}
      <SectionCard title="Commission per Close" icon={<IndianRupee className="h-3.5 w-3.5" />}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Approved closes" value={num(closes)} tone="success" hint="drives your tier" />
          <Stat
            label="Commission per close"
            value={inr(data.commission?.amount ?? data.profile.commissionPerDeal)}
            hint={data.commission?.slab?.label ?? "flat rate"}
            tone="info"
          />
          <Stat
            label="Current rank"
            value={rank ? `#${rank.rank}` : "—"}
            hint={rank?.label ?? "no closes yet"}
            tone="warn"
          />
          <Stat
            label="Next tier at"
            value={data.commission?.nextSlab ? `${data.commission.nextSlab.minCloses} closes` : "Top tier"}
            hint={data.commission?.nextSlab?.label ?? "you are at the ceiling"}
          />
        </div>
      </SectionCard>

      {/* ---------- digital ID card ---------- */}
      <Button variant="secondary" className="w-full" size="lg" onClick={() => setIdOpen(true)}>
        <IdCard className="h-4 w-4" /> View / Print Digital ID Card
      </Button>

      {/* ---------- wallet + tier ---------- */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Wallet total" value={inr(data.profile.walletTotal)} />
        <Stat label="Pending" value={inr(data.profile.walletPending)} tone="warn" />
        <Stat label="Withdrawn" value={inr(data.profile.walletApproved)} tone="success" />
        <Stat
          label="Current slab"
          value={data.commission?.slab?.label ?? "—"}
          hint={data.commission ? `${inr(data.commission.amount)} per close · ${num(data.commission.closes)} approved` : ""}
          tone="info"
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* ---------- payout details ---------- */}
        <SectionCard
          title="Bank / UPI Details"
          icon={<ShieldCheck className="h-3.5 w-3.5" />}
          action={
            locked ? (
              <Badge variant="success">
                <Lock className="h-2.5 w-2.5" /> Approved &amp; locked
              </Badge>
            ) : (
              <Badge variant="warn">Editable</Badge>
            )
          }
        >
          <div className={cn("grid grid-cols-1 gap-2 sm:grid-cols-2", locked && "pointer-events-none opacity-70")}>
            <div className="space-y-1">
              <Label>Bank name</Label>
              <Input value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} disabled={locked} />
            </div>
            <div className="space-y-1">
              <Label>Account number</Label>
              <Input value={form.bankAccount} onChange={(e) => setForm({ ...form, bankAccount: e.target.value })} disabled={locked} />
            </div>
            <div className="space-y-1">
              <Label>IFSC code</Label>
              <Input
                value={form.bankIfsc}
                onChange={(e) => setForm({ ...form, bankIfsc: e.target.value.toUpperCase() })}
                disabled={locked}
                placeholder="HDFC0001234"
              />
            </div>
            <div className="space-y-1">
              <Label>UPI ID</Label>
              <Input value={form.upiId} onChange={(e) => setForm({ ...form, upiId: e.target.value })} disabled={locked} placeholder="name@upi" />
            </div>
          </div>
          {locked ? (
            <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2 py-1.5 text-[10px] font-medium text-emerald-700">
              <Lock className="h-3 w-3 shrink-0" /> These details were approved by HR/Admin and are permanently read-only. Ask HR/Admin to
              unlock them if they change.
            </p>
          ) : (
            <Button size="lg" className="mt-2 w-full" onClick={() => void patch(form)} disabled={busy}>
              <Save className="h-4 w-4" /> Submit payout details for approval
            </Button>
          )}

          {data.viewer.canManage ? (
            <div className="mt-2 flex flex-wrap gap-2 border-t pt-2">
              <Button
                size="sm"
                variant={locked ? "outline" : "success"}
                disabled={busy}
                onClick={() => void patch({ payoutLocked: !locked })}
              >
                {locked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                {locked ? "Unlock payout details" : "Approve & lock payout details"}
              </Button>
            </div>
          ) : null}
        </SectionCard>

        {/* ---------- KYC documents ---------- */}
        <SectionCard title="KYC Documents" icon={<IdCard className="h-3.5 w-3.5" />}>
          {/* REJECTED: reason + re-upload & re-submit */}
          {data.profile.kycStatus === "REJECTED" || kycReject ? (
            <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3">
              <p className="flex items-center gap-1.5 text-xs font-bold text-rose-900">
                <ShieldAlert className="h-4 w-4" /> KYC rejected by {kycReject?.by ?? "management"}
              </p>
              <p className="mt-1 text-[11px] text-rose-800">
                {kycReject?.reason ?? "Your documents did not pass verification."}
              </p>
              {kycReject?.at ? <p className="mt-0.5 text-[10px] text-rose-600">Reviewed {dateTime(kycReject.at)}</p> : null}
              <p className="mt-2 text-[11px] font-semibold text-rose-900">Re-upload &amp; re-submit your KYC below.</p>
            </div>
          ) : null}

          {data.profile.kycStatus === "APPROVED" ? (
            <div className="mb-3 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-2.5">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              <p className="text-[11px] font-semibold text-emerald-800">KYC verified — no action needed.</p>
            </div>
          ) : null}

          {/* hidden re-upload input for rejected documents */}
          <input
            ref={resubmitRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void resubmitKyc(f);
            }}
          />
          <input
            ref={kycInput}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void (async () => {
                const url = await uploadDoc(f, kycKind.current);
                if (url && kycKind.current === "PHOTO") await patch({ avatarUrl: url });
              })();
            }}
          />
          <input
            ref={marksheetInput}
            type="file"
            accept="image/*,application/pdf"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              void (async () => {
                for (const f of files) {
                  if (marksheets.length >= 5) {
                    toast.error("Maximum of 5 marksheets");
                    break;
                  }
                  await uploadDoc(f, "MARKSHEET");
                }
              })();
            }}
          />

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              { key: "AADHAAR", label: "Aadhaar Card", url: data.profile.kycAadhaarUrl, icon: IdCard },
              { key: "PHOTO", label: "Passport Photo", url: data.profile.kycPhotoUrl, icon: Camera },
              { key: "PAN", label: "PAN Card", url: data.profile.kycPanUrl, icon: ShieldCheck },
            ].map((doc) => (
              <div key={doc.key} className="rounded-xl border p-2">
                <p className="flex items-center gap-1 text-[10px] font-semibold">
                  <doc.icon className="h-3 w-3" /> {doc.label}
                </p>
                {doc.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={doc.url}
                    alt={doc.label}
                    onClick={() => setPreview({ url: doc.url!, label: doc.label })}
                    className="mt-1.5 h-24 w-full cursor-zoom-in rounded-lg object-cover"
                  />
                ) : (
                  <button
                    onClick={() => {
                      kycKind.current = doc.key;
                      kycInput.current?.click();
                    }}
                    className="mt-1.5 flex h-24 w-full items-center justify-center rounded-lg border border-dashed text-[10px] text-muted-foreground"
                  >
                    <Upload className="h-4 w-4" />
                  </button>
                )}
                {doc.url ? (
                  data.profile.kycStatus === "REJECTED" ? (
                    <button
                      onClick={() => {
                        setResubmitKind(doc.key);
                        resubmitRef.current?.click();
                      }}
                      className="mt-1 w-full rounded bg-rose-600 py-1 text-[9px] font-bold text-white"
                    >
                      Re-upload
                    </button>
                  ) : (
                    <p className="mt-1 flex items-center gap-1 text-[9px] text-emerald-600">
                      <CheckCircle2 className="h-2.5 w-2.5" /> uploaded
                    </p>
                  )
                ) : null}
              </div>
            ))}
          </div>

          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                <GraduationCap className="h-3.5 w-3.5" /> Qualification &amp; Marksheets
              </p>
              <Badge variant="muted">{marksheets.length}/5</Badge>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Highest qualification</Label>
                <NativeSelect value={form.qualification} onChange={(e) => setForm({ ...form, qualification: e.target.value })}>
                  <option value="">— select —</option>
                  {QUALIFICATIONS.map((q) => (
                    <option key={q} value={q}>
                      {q}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1">
                <Label>Upload marksheets (max 5)</Label>
                <Button variant="outline" className="w-full" onClick={() => marksheetInput.current?.click()}>
                  <Upload className="h-4 w-4" /> Choose files
                </Button>
              </div>
            </div>
            {marksheets.length ? (
              <div className="mt-1 flex flex-wrap gap-2">
                {marksheets.map((m) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={m.id}
                    src={m.url}
                    alt={m.fileName ?? "marksheet"}
                    onClick={() => setPreview({ url: m.url, label: m.fileName ?? "Marksheet" })}
                    className="h-16 w-16 cursor-zoom-in rounded-lg border object-cover"
                  />
                ))}
              </div>
            ) : null}
          </div>

          <Button size="lg" className="mt-3 w-full" onClick={() => void patch({ qualification: form.qualification })} disabled={busy}>
            <Save className="h-4 w-4" /> Save qualification
          </Button>
        </SectionCard>

        {/* ---------- phones ---------- */}
        <SectionCard title="Contact Numbers" icon={<Phone className="h-3.5 w-3.5" />}>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>Working phone</Label>
              <Input inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Alternative phone</Label>
              <Input inputMode="tel" value={form.altPhone} onChange={(e) => setForm({ ...form, altPhone: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Parent / Guardian</Label>
              <Input inputMode="tel" value={form.guardianPhone} onChange={(e) => setForm({ ...form, guardianPhone: e.target.value })} />
            </div>
          </div>
          <Button size="lg" className="mt-2 w-full" onClick={() => void patch(form)} disabled={busy}>
            <Save className="h-4 w-4" /> Save contact numbers
          </Button>
        </SectionCard>

      </div>

      {/* ---------- staff-only: about + badges ---------- */}
      {data.viewer.canManage ? (
        <SectionCard title="Admin / HR — Agent Profile Notes" icon={<BadgeCheck className="h-3.5 w-3.5" />}>
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-1">
              <Label>About Person</Label>
              <Textarea
                value={about}
                onChange={(e) => setAbout(e.target.value)}
                placeholder="Consistent performer from Indore. Strong with Real Estate owners; needs polish on objection handling."
                className="min-h-[110px]"
              />
            </div>
            <div className="space-y-1">
              <Label>Role &amp; Badges</Label>
              <div className="flex flex-wrap gap-1.5">
                {BADGE_OPTIONS.map((b) => {
                  const on = badges.includes(b);
                  return (
                    <button
                      key={b}
                      onClick={() => setBadges(on ? badges.filter((x) => x !== b) : [...badges, b])}
                      className={cn(
                        "flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold transition",
                        on ? "border-violet-300 bg-violet-50 text-violet-700" : "border-slate-200 bg-white text-slate-500",
                      )}
                    >
                      {on ? <CheckCircle2 className="h-3 w-3" /> : <Award className="h-3 w-3" />} {b}
                    </button>
                  );
                })}
              </div>
              <Button size="lg" className="mt-2 w-full" disabled={busy} onClick={() => void patch({ aboutPerson: about, badges })}>
                <Save className="h-4 w-4" /> Save profile notes &amp; badges
              </Button>
            </div>
          </div>
        </SectionCard>
      ) : null}

      {/* ---------- daily activity logs ---------- */}

      <LiveActivityCounter state={interaction.state} className="mb-3" />

      <SectionCard title="Daily Activity & Performance Logs" icon={<CalendarDays className="h-3.5 w-3.5" />}>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          <Stat label="Today active" value={hms(data.activityToday.activeSeconds)} tone="success" hint="tab-visible only" />
          <Stat label="Today touched" value={num(data.activityToday.touchedLeads)} />
          <Stat label="Today status changes" value={num(data.activityToday.statusChanges)} tone="info" />
          <Stat label="Today deals closed" value={num(data.activityToday.dealsClosed)} tone="warn" />
          <Stat label="Today calls" value={num(data.activityToday.callsMade)} />
        </div>

        <div className="mt-3 overflow-x-auto thin-scroll">
          <table className="w-full min-w-[600px] text-left text-xs">
            <thead className="border-b text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="p-2">Day</th>
                <th className="p-2">Active time</th>
                <th className="p-2">Leads touched</th>
                <th className="p-2">Status changes</th>
                <th className="p-2">Deals closed</th>
                <th className="p-2">Calls</th>
              </tr>
            </thead>
            <tbody>
              {data.dailyActivity.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-muted-foreground">
                    No daily snapshots yet — they build up as the agent works.
                  </td>
                </tr>
              ) : null}
              {data.dailyActivity.map((d) => (
                <tr key={d.day} className="border-b last:border-0">
                  <td className="p-2 font-semibold">{d.day}</td>
                  <td className="p-2 tabular-nums text-emerald-700">{hms(d.activeSeconds)}</td>
                  <td className="p-2 tabular-nums">{num(d.touchedLeads)}</td>
                  <td className="p-2 tabular-nums">{num(d.statusChanges)}</td>
                  <td className="p-2 tabular-nums font-semibold">{num(d.dealsClosed)}</td>
                  <td className="p-2 tabular-nums">{num(d.callsMade)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 flex items-center gap-1 text-[10px] text-muted-foreground">
          <Clock className="h-3 w-3" /> Lifetime: {hms(data.activityTotals.activeSeconds)} active across {data.activityTotals.days} day(s) ·{" "}
          {num(data.activityTotals.touchedLeads)} leads touched · {num(data.activityTotals.dealsClosed)} deals closed
        </p>
      </SectionCard>

      <p className="pb-2 text-center text-[10px] text-muted-foreground">
        Member since {dateTime(data.profile.createdAt)} · last seen {timeAgo(data.profile.createdAt)}
      </p>

      {/* ---------- printable ID card ---------- */}
      <Sheet
        open={idOpen}
        onOpenChange={setIdOpen}
        title="Digital ID Card"
        description="Official Auto Growth Systems caller ID — printable for field visits."
        footer={
          <Button className="w-full" onClick={() => window.print()}>
            Print / Save as PDF
          </Button>
        }
      >
        <div className="mx-auto w-full max-w-sm overflow-hidden rounded-2xl border-4 border-blue-700 bg-white shadow-lg">
          <div className="flex items-center gap-2 bg-blue-700 px-3 py-2 text-white">
            <span className="text-lg">📞</span>
            <div className="flex-1">
              <p className="text-xs font-bold leading-none">Auto Growth Systems</p>
              <p className="text-[9px] text-blue-100">Telecalling &amp; HR Suite</p>
            </div>
            <span className="rounded bg-white/20 px-1.5 py-0.5 text-[9px] font-bold">{data.profile.role}</span>
          </div>
          <div className="flex gap-3 p-3">
            {data.profile.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <SafeImage src={data.profile.avatarUrl} alt="Profile photo" className="h-24 w-20 shrink-0 rounded-lg border object-cover" />
            ) : (
              <div className="flex h-24 w-20 shrink-0 items-center justify-center rounded-lg border bg-slate-100 text-xl font-bold text-slate-400">
                {data.profile.name.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1 space-y-1 text-[11px]">
              <p className="truncate text-sm font-bold leading-tight">{data.profile.name}</p>
              <p className="truncate text-muted-foreground">{data.profile.email}</p>
              <Row label="ID" value={String(data.profile.id).padStart(5, "0")} />
              <Row label="Phone" value={data.profile.phone ?? "—"} />
              <Row label="Niche" value={data.profile.nicheName ?? "All"} />
              <Row label="Since" value={dateTime(data.profile.createdAt).split(",")[0]} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1 border-t bg-slate-50 p-2 text-center text-[9px]">
            <div>
              <p className="text-muted-foreground">Closes</p>
              <p className="text-sm font-bold tabular-nums">{num(closes)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Per close</p>
              <p className="text-sm font-bold tabular-nums text-emerald-700">{inr(data.commission?.amount ?? 0)}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Rank</p>
              <p className="text-sm font-bold text-amber-700">#{rank?.rank ?? "—"}</p>
            </div>
          </div>
          {(data.profile.badges ?? []).length ? (
            <div className="flex flex-wrap gap-1 border-t p-2">
              {(data.profile.badges ?? []).map((b) => (
                <span key={b} className="rounded-full bg-violet-50 px-1.5 py-0.5 text-[9px] font-semibold text-violet-700">
                  🏅 {b}
                </span>
              ))}
            </div>
          ) : null}
          <div className="border-t bg-blue-50 px-3 py-1.5 text-center text-[8px] text-blue-800">
            {rank ? `${rank.rank}. ${rank.label}` : "Provisional Caller"} · KYC {data.profile.kycStatus} · ID verified by Auto Growth Systems
          </div>
        </div>
      </Sheet>

      <Sheet open={Boolean(preview)} onOpenChange={(v) => !v && setPreview(null)} title={preview?.label ?? "Document"} description="KYC document preview">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <SafeImage src={preview.url} alt={preview.label} className="max-h-[60vh] w-full rounded-xl bg-slate-100 object-contain" />
        ) : null}
      </Sheet>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <p className="flex items-center justify-between gap-2 border-b border-dashed border-slate-200 pb-0.5">
      <span className="shrink-0 text-[9px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="truncate font-semibold">{value}</span>
    </p>
  );
}
