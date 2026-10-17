"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Clock, GraduationCap, IdCard, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Input, Label, Stat } from "@/components/ui/field";
import { Sheet } from "@/components/ui/dialog";
import { cn, hms, inr } from "@/lib/utils";

type Profile = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  walletTotal: string;
  walletPending: string;
  walletApproved: string;
  commissionPerDeal: string;
  bankName: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  upiId: string | null;
  kycStatus: string;
  kycAadhaarUrl: string | null;
  kycMarksheetUrl: string | null;
  kycPhotoUrl: string | null;
  kycPanUrl: string | null;
  activeSeconds: number;
  nicheName: string | null;
};

type KycKey = "kycAadhaarUrl" | "kycMarksheetUrl" | "kycPhotoUrl" | "kycPanUrl";

const KYC_FIELDS: Array<{ key: KycKey; label: string; icon: typeof IdCard }> = [
  { key: "kycAadhaarUrl", label: "Aadhaar card", icon: IdCard },
  { key: "kycMarksheetUrl", label: "10th marksheet", icon: GraduationCap },
  { key: "kycPhotoUrl", label: "Passport photo", icon: Camera },
  { key: "kycPanUrl", label: "PAN card", icon: ShieldCheck },
] as const;

export function AgentProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [form, setForm] = useState({ bankName: "", bankAccount: "", bankIfsc: "", upiId: "", phone: "" });
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeField = useRef<KycKey | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/agent/profile");
    if (!res.ok) return;
    const json = (await res.json()) as { profile: Profile };
    setProfile(json.profile);
    setForm({
      bankName: json.profile.bankName ?? "",
      bankAccount: json.profile.bankAccount ?? "",
      bankIfsc: json.profile.bankIfsc ?? "",
      upiId: json.profile.upiId ?? "",
      phone: json.profile.phone ?? "",
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function uploadKyc(file: File) {
    const field = activeField.current;
    if (!field) return;
    const body = new FormData();
    body.append("file", file);
    body.append("kind", field.toUpperCase());
    const res = await fetch("/api/upload", { method: "POST", body });
    const json = (await res.json()) as { url?: string; error?: string };
    if (!res.ok || !json.url) {
      toast.error(json.error ?? "Upload failed");
      return;
    }
    const patch = await fetch("/api/agent/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: json.url }),
    });
    if (patch.ok) {
      toast.success("Document uploaded — pending HR verification");
      await load();
    }
  }

  async function saveBank() {
    setSaving(true);
    const res = await fetch("/api/agent/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) toast.success("Payout details saved");
    else toast.error("Could not save");
    setSaving(false);
  }

  const kycDone = [profile?.kycAadhaarUrl, profile?.kycMarksheetUrl, profile?.kycPhotoUrl, profile?.kycPanUrl].filter(Boolean).length;

  return (
    <div className="space-y-3 p-3 sm:p-4 lg:p-6">
      <div className="rounded-xl border bg-white p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 text-lg font-bold text-white">
            {profile?.name.slice(0, 2).toUpperCase() ?? "…"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold">{profile?.name ?? "Loading…"}</p>
            <p className="truncate text-xs text-muted-foreground">{profile?.email}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <Badge variant="muted">{profile?.role ?? "AGENT"}</Badge>
              <Badge variant="outline">{profile?.nicheName ?? "All niches"}</Badge>
              <Badge variant={profile?.kycStatus === "APPROVED" ? "success" : profile?.kycStatus === "UNDER_REVIEW" ? "warn" : "danger"}>
                KYC {profile?.kycStatus ?? "PENDING"}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Wallet total" value={inr(profile?.walletTotal)} />
        <Stat label="Pending" value={inr(profile?.walletPending)} tone="warn" />
        <Stat label="Approved" value={inr(profile?.walletApproved)} tone="success" />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-xl border bg-white p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Payment / bank details</p>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Bank name</Label>
              <Input value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Account number</Label>
              <Input value={form.bankAccount} onChange={(e) => setForm({ ...form, bankAccount: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>IFSC</Label>
              <Input value={form.bankIfsc} onChange={(e) => setForm({ ...form, bankIfsc: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>UPI ID</Label>
              <Input value={form.upiId} onChange={(e) => setForm({ ...form, upiId: e.target.value })} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label>Mobile number</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
          </div>
          <Button size="lg" className="mt-3 w-full" onClick={() => void saveBank()} disabled={saving}>
            <Save className="h-4 w-4" /> Save payout details
          </Button>
        </section>

        <section className="rounded-xl border bg-white p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">KYC documents ({kycDone}/4 uploaded)</p>
          <input
            ref={inputRef}
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadKyc(file);
            }}
          />
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {KYC_FIELDS.map((f) => {
              const url = profile?.[f.key] as string | null;
              return (
                <div key={f.key} className="rounded-xl border p-2">
                  <p className="flex items-center gap-1 text-[11px] font-semibold">
                    <f.icon className="h-3.5 w-3.5" /> {f.label}
                  </p>
                  {url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={url}
                      alt={f.label}
                      onClick={() => setPreview({ url, label: f.label })}
                      className="mt-1.5 h-24 w-full cursor-zoom-in rounded-lg object-cover sm:h-20"
                    />
                  ) : (
                    <button
                      onClick={() => {
                        activeField.current = f.key;
                        inputRef.current?.click();
                      }}
                      className="mt-1.5 flex h-24 w-full items-center justify-center rounded-lg border border-dashed text-[11px] text-muted-foreground sm:h-20"
                    >
                      + Upload
                    </button>
                  )}
                  {url ? (
                    <div className="mt-1 flex items-center justify-between">
                      <span className="flex items-center gap-1 text-[10px] text-emerald-600">
                        <CheckCircle2 className="h-3 w-3" /> Uploaded
                      </span>
                      <button className="text-[10px] text-blue-600" onClick={() => setPreview({ url, label: f.label })}>
                        View
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            Files are stored in Backblaze B2 and the public URL is saved to the database.
          </p>
        </section>
      </div>

      <div className="rounded-xl border bg-white p-4">
        <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          <Clock className="h-3.5 w-3.5" /> Active time tracker
        </p>
        <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-600">{hms(profile?.activeSeconds ?? 0)}</p>
        <p className="text-[11px] text-muted-foreground">
          Tracked with the Page Visibility API — only while this tab is focused. Synced to /api/agent/track-time every 60 seconds.
        </p>
        <div className={cn("mt-2 rounded-lg px-2 py-1 text-[11px]", "bg-emerald-50 text-emerald-700")}>
          Commission per approved deal: {inr(profile?.commissionPerDeal)}
        </div>
      </div>

      <Sheet open={Boolean(preview)} onOpenChange={(v) => !v && setPreview(null)} title={preview?.label ?? "Document"} description="KYC document preview">
        <div className="space-y-3">
          <div className="overflow-auto rounded-xl border bg-slate-50 p-2 thin-scroll">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.url} alt={preview.label} style={{ transform: `scale(${zoom})` }} className="mx-auto origin-top transition-transform" />
            ) : null}
          </div>
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
              −
            </Button>
            <span className="w-14 text-center text-xs">{Math.round(zoom * 100)}%</span>
            <Button variant="outline" size="sm" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
              +
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
