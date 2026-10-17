"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  History as HistoryIcon,
  BadgeCheck,
  CalendarClock,
  Building2,
  Clock,
  Copy,
  Eye,
  ImagePlus,
  IndianRupee,
  Lock,
  Phone,
  RefreshCcw,
  Repeat,
  Send,
  Star,
  Unlock,
  Users,
  X,
  XCircle,
  TriangleAlert,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { SafeImage } from "@/components/shared/safe-image";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, Sheet } from "@/components/ui/dialog";
import { Badge, Input, Label, NativeSelect, Textarea } from "@/components/ui/field";
import { NumberInput } from "@/components/ui/number-input";
import { AGENT_FILTERS } from "@/lib/rbac";
import { cn, dateTime, hms, inr, renderTemplate, timeAgo, waLink } from "@/lib/utils";
import { uploadFile } from "@/components/shared/upload-file";
import { useInteraction } from "@/components/shared/security-guard";
import { FieldGrid, toPolicyFields } from "@/components/lead-fields";
import { LEAD_FIELDS } from "@/lib/fields";

export type LeadDetail = {
  lead: Record<string, unknown> & {
    id: number;
    contactName: string | null;
    callCount: number;
    dealAmount?: string | null;
  };
  canDial?: boolean;
  dialTarget?: string | null;
  fieldPolicy?: Record<string, string>;
  locked: boolean;
  submitted: boolean;
  history: {
    allowed: boolean;
    pastCount: number;
    requests: Array<{ id: number; status: string; resolvedNote: string | null; createdAt: string }>;
  };
  pastNotes: Array<{ id: number; status: string; notes: string | null; durationSeconds: number; createdAt: string; callStartedAt: string | null }>;
  myLogs: Array<{ id: number; status: string; notes: string | null; durationSeconds: number; createdAt: string; callStartedAt: string | null }>;
  templates: Array<{ id: number; title: string; body: string }>;
  uploads: Array<{ id: number; kind: string; fileName: string | null; createdAt: string }>;
  correction: Array<{ id: number; reason: string; status: string; createdAt: string }>;
  /** Last rejected deal so the agent can re-upload proof. */
  lastRejection?: {
    id: number;
    rejectionReason: string | null;
    reviewNote: string | null;
    amount: string;
    decidedAt: string | null;
  } | null;
  proofLocked?: boolean;
};

const STATUS_OPTIONS = AGENT_FILTERS.map((s) => ({ value: s.key, label: s.label }));

export function LeadModal({
  leadId,
  onClose,
  onChanged,
}: {
  leadId: number;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<LeadDetail | null>(null);
  // lead-open telemetry: timestamp + duration + the action that opened it
  const { trackLeadOpen, trackLeadClose, trackAction, state: interactionState } = useInteraction();
  const openedAtRef = useRef<number>(Date.now());
  const [templateId, setTemplateId] = useState<number>(0);
  const [status, setStatus] = useState("IN_PROGRESS");
  const [notes, setNotes] = useState("");
  const [dealAmount, setDealAmount] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [callOutcome, setCallOutcome] = useState("Connected");
  // Callback scheduling — required when the agent selects the Call back stage.
  const [callbackDate, setCallbackDate] = useState("");
  const [callbackTime, setCallbackTime] = useState("");
  const [duration, setDuration] = useState(0);
  const [callActive, setCallActive] = useState(false);
  const [logId, setLogId] = useState<number | null>(null);
  const [callStartedAt, setCallStartedAt] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [uploadedFileId, setUploadedFileId] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ url: string; label: string } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionReason, setCorrectionReason] = useState("");
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceReason, setReplaceReason] = useState("");
  const [histReasOpen, setHistReasOpen] = useState(false);
  const [histReason, setHistReason] = useState("");
  const [rejectionOpen, setRejectionOpen] = useState(false);
  // "Report Lead Error" — routes to the Admin/HR/Manager Lead Errors queue.
  const [errorOpen, setErrorOpen] = useState(false);
  // "I Lost My Efforts" — releases the lead back to the management pool
  const [lostOpen, setLostOpen] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [errorCategory, setErrorCategory] = useState("WRONG_NUMBER");
  const [errorDetails, setErrorDetails] = useState("");
  const [errorProof, setErrorProof] = useState<string | null>(null);
  const errorFileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  /** Policy-safe accessor: returns a string, or null when the field is hidden. */
  const F = (key: string): string | null => {
    if (!detail) return null;
    if (detail.fieldPolicy?.[key] === "HIDDEN") return null;
    const v = detail.lead[key];
    return v === null || v === undefined || v === "" ? null : String(v);
  };
  const isHidden = (key: string) => detail?.fieldPolicy?.[key] === "HIDDEN";
  const isMasked = (key: string) => detail?.fieldPolicy?.[key] === "MASKED";

  const load = useCallback(async () => {
    const res = await fetch(`/api/agent/leads/${leadId}`);
    if (!res.ok) {
      toast.error("Unable to open lead");
      onClose();
      return;
    }
    const json = (await res.json()) as LeadDetail;
    setDetail(json);
    const current = json.lead.status ? String(json.lead.status) : "IN_PROGRESS";
    setStatus(current === "NEW" ? "IN_PROGRESS" : current);
    if (json.templates.length) setTemplateId(json.templates[0]!.id);
    if (json.uploads.length) setProofUrl(`/api/files/${json.uploads[0]!.id}`);

  }, [leadId, onClose]);

  /* record the lead open (server timestamped) + start the duration clock */
  useEffect(() => {
    openedAtRef.current = Date.now();
    void trackLeadOpen(leadId, "OPEN");
    return () => {
      // closing the modal (or navigating away) stores how long it was open
      trackLeadClose(leadId, openedAtRef.current);
    };
  }, [leadId, trackLeadOpen, trackLeadClose]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!callActive) return;
    const timer = setInterval(() => setDuration((d) => d + 1), 1000);
    return () => clearInterval(timer);
  }, [callActive]);

  const message = useMemo(() => {
    if (!detail) return "";
    const tpl = detail.templates.find((t) => t.id === templateId) ?? detail.templates[0];
    if (!tpl) return "";
    const lead = detail.lead as Record<string, unknown>;
    // Template placeholders only inject fields the viewer is allowed to see.
    return renderTemplate(tpl.body, {
      business_name: F("business_name") ?? "your business",
      contact_name: detail.lead.contactName ?? "Sir/Madam",
      reviews_count: F("reviews_count") ?? "your",
      competitor_reviews: F("competitor_reviews") ?? "more",
      competitor_name: F("competitor_name") ?? "nearby competitors",
      rating: F("rating") ?? "0",
      city: F("city_keyword") ?? "your area",
      phone: F("phone") ?? "",
      lead_code: F("lead_code") ?? "",
      opens_at: F("opens_at") ?? "",
      website_url: F("website_url") ?? "",
      website_status: F("website_status") ?? "",
      service_status: F("service_status") ?? "",
      call_status: F("call_status") ?? "",
      category_name: F("category_name") ?? "",
      gmap_link: F("gmap_link") ?? "",
      status: F("status") ?? "",
      ...lead,
    } as Record<string, unknown>);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, templateId]);

  async function post(body: Record<string, unknown>) {
    const res = await fetch(`/api/agent/leads/${leadId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) throw new Error(String(json.error ?? "Action failed"));
    return json;
  }

  async function startCall() {
    if (detail?.locked) {
      toast.error("Prospect details are locked until Admin/Manager approves access.");
      return;
    }
    try {
      const json = await post({ action: "call-start" });
      setLogId(Number(json.logId));
      setCallStartedAt(String(json.startedAt));
      setCallActive(true);
      setDuration(0);
      toast.success("Dialer opened — call duration is being tracked");
      // the CALL action is a tracked lead-open (timestamp + action recorded)
      void trackLeadOpen(leadId, "CALL");
      window.location.href = `tel:${detail?.lead.phone ?? ""}`;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start call");
    }
  }

  async function submitReport() {
    setBusy(true);
    try {
      await post({
        action: "report",
        logId,
        status,
        notes,
        callbackAt: status === "CALLBACK" && callbackDate && callbackTime ? `${callbackDate}T${callbackTime}` : undefined,
        dealAmount: dealAmount ? Number(dealAmount) : undefined,
        durationSeconds: duration,
        callStartedAt,
        whatsappSent: Boolean(whatsappSentRef.current),
        whatsappTemplateId: templateId || undefined,
        proofUrl,
      });
      toast.success("Report submitted & locked");
      setCallActive(false);
      await load();
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Submit failed");
    } finally {
      setBusy(false);
    }
  }

  async function upload(file: File) {
    setUploading(true);
    try {
      const result = await uploadFile(file, { leadId, kind: "CALL_PROOF", silent: true });
      // url is ALWAYS renderable (B2 url, /api/files url, or inline base64)
      setProofUrl(result.url || result.dataUrl || null);
      setUploadedFileId(result.id ?? null);
      if (result.ok) toast.success("Proof uploaded securely");
      await load();
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const whatsappSentRef = useRef(false);
  const locked = detail?.locked ?? true;
  const alreadySubmitted = detail?.submitted ?? false;

  if (!detail) {
    return (
      <Dialog open onOpenChange={(v) => !v && onClose()}>
        <DialogContent fullscreen hideClose className="items-center justify-center">
          <p className="text-sm text-muted-foreground">Loading lead…</p>
        </DialogContent>
      </Dialog>
    );
  }

  const reviewsVal = F("reviews_count");
  const compVal = F("competitor_reviews");
  const gap = reviewsVal && compVal ? Number(compVal) - Number(reviewsVal) : null;
  const statusVal = F("status") ?? "IN_PROGRESS";
  const headerTitle = F("business_name") ?? `Lead #${detail.lead.id}`;
  const dialNumber = detail.dialTarget ?? F("phone_normalized") ?? F("phone");

  // Status moved away from what is stored (label only — never blocks submit).
  const statusChanged = status !== statusVal;
  // Proof input renders only for Payment Approval (or to re-upload a rejected proof).
  const showProofSection = status === "PAYMENT_APPROVAL" || Boolean(detail.lastRejection);
  // Uploaded file reference that ties the proof to the deal approval.
  const uploadedId = uploadedFileId;
  // Notes are always required; proof is required ONLY for Payment Approval,
  // and a date+time is required ONLY for Call back.
  const needsCallback = status === "CALLBACK";
  const canSubmit =
    !busy &&
    !locked &&
    notes.trim().length >= 3 &&
    (status !== "PAYMENT_APPROVAL" || Boolean(proofUrl)) &&
    (!needsCallback || Boolean(callbackDate && callbackTime));

  return (
    <>
      <Dialog open onOpenChange={(v) => !v && onClose()}>
        <DialogContent fullscreen hideClose>
          {/* sticky header */}
          <div className="sticky top-0 z-30 border-b bg-white/95 px-3 py-2.5 backdrop-blur sm:px-4 sm:py-3">
            <div className="flex items-start gap-2 pr-14">
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-bold">{headerTitle}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {F("lead_code") ?? `#${detail.lead.id}`} · {F("category_name") ?? "—"} · {F("city_keyword") ?? "—"}
                </p>
              </div>
              <Badge className={cn("shrink-0", statusChip(statusVal))}>{statusVal.replace("_", " ")}</Badge>
            </div>
            <button
              onClick={onClose}
              className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg"
              aria-label="Close lead"
            >
              <X className="h-5 w-5" />
            </button>
            {locked ? (
              <p className="mt-2 flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700">
                <Lock className="h-3 w-3" /> Prospect details locked — Admin/Manager approval required
              </p>
            ) : null}
          </div>

          <div className="space-y-3 p-3 pb-32 sm:space-y-4 sm:p-4">
            {/* prospect info */}
            <section className="rounded-xl border bg-white p-3 sm:p-4">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  <Building2 className="h-3.5 w-3.5" /> Prospect info
                </p>
                <span className="shrink-0 text-[10px] text-muted-foreground">{detail.lead.callCount} calls</span>
              </div>

              {/* ---- dynamic, admin-governed field grid ---- */}
              <FieldGrid
                className="mt-2"
                fields={toPolicyFields(
                  detail.lead as Record<string, unknown>,
                  {
                    lead_code: "Lead #",
                    city_keyword: "City Keyword",
                    category_name: "Niche",
                    opens_at: "Opens At",
                    service_status: "Service Status",
                    website_status: "Website Status",
                    call_status: "Call Outcome",
                    status: "Pipeline",
                    phone: "Phone",
                    phone_normalized: "Phone (E.164)",
                  },
                  detail.fieldPolicy ?? {},
                )}
              />

              {/* gmap + website as links */}
              {!isHidden("gmap_link") || !isHidden("website_url") ? (
                <div className="mt-2 space-y-1">
                  {!isHidden("gmap_link") ? (
                    <LinkRow label="Google Maps" value={F("gmap_link")} masked={isMasked("gmap_link")} />
                  ) : null}
                  {!isHidden("website_url") ? (
                    <LinkRow label="Website" value={F("website_url")} masked={isMasked("website_url")} />
                  ) : null}
                </div>
              ) : null}

              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <Info label="Contact" value={locked ? "••••••" : detail.lead.contactName ?? "—"} />
                <Info label="Assigned" value={timeAgo(detail.lead.assignedAt as string | null)} />
              </div>

              {/* Google signals — only when visible */}
              {!isHidden("rating") || !isHidden("reviews_count") ? (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  {!isHidden("rating") ? (
                    <div className="rounded-lg bg-amber-50 p-2 text-center">
                      <p className="flex items-center justify-center gap-1 text-[10px] font-semibold text-amber-700">
                        <Star className="h-3 w-3 fill-amber-500 text-amber-500" /> Rating
                      </p>
                      <p className="text-lg font-bold text-amber-700">{Number(F("rating") ?? 0).toFixed(1)}</p>
                    </div>
                  ) : null}
                  {!isHidden("reviews_count") ? (
                    <div className="rounded-lg bg-blue-50 p-2 text-center">
                      <p className="text-[10px] font-semibold text-blue-700">Your reviews</p>
                      <p className="text-lg font-bold text-blue-700">{reviewsVal ?? "••"}</p>
                    </div>
                  ) : null}
                  {!isHidden("reviews_count") ? (
                    <div className="rounded-lg bg-rose-50 p-2 text-center">
                      <p className="truncate text-[10px] font-semibold text-rose-700">{F("competitor_name") ?? "Competitor"}</p>
                      <p className="text-lg font-bold text-rose-700">{compVal ?? "••"}</p>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {gap !== null ? (
                <p className={cn("mt-2 rounded-lg px-2 py-1 text-[11px] font-medium", gap > 0 ? "bg-slate-100 text-slate-700" : "bg-emerald-50 text-emerald-700")}>
                  {gap > 0 ? `Review gap: ${gap} behind ${F("competitor_name") ?? "competitor"}` : "You lead on review volume 🎉"}
                </p>
              ) : null}

              {detail.canDial === false ? (
                <p className="mt-3 flex items-center gap-1 rounded-lg bg-rose-50 px-2 py-1.5 text-[11px] font-medium text-rose-700">
                  <Lock className="h-3 w-3" /> Phone hidden for your role — request access to call
                </p>
              ) : null}

              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button onClick={() => void startCall()} disabled={locked || detail.canDial === false}>
                  <Phone className="h-4 w-4 shrink-0" /> <span className="truncate">{callActive ? `Calling · ${hms(duration)}` : "Call now"}</span>
                </Button>
                <Button variant="outline" onClick={() => dialNumber && navigator.clipboard.writeText(dialNumber)} disabled={locked || !dialNumber}>
                  <Copy className="h-4 w-4" /> Copy number
                </Button>
              </div>
              {locked ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 w-full"
                  onClick={async () => {
                    await post({ action: "unlock-request" });
                    toast.success("Unlock request sent to Admin");
                  }}
                >
                  <Unlock className="h-4 w-4" /> Request detail access
                </Button>
              ) : null}
            </section>

            {/* audit history from previous agents (anonymous) */}
            <section className="rounded-xl border bg-white p-3 sm:p-4">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                <Users className="h-3.5 w-3.5" /> Audit history · previous agents (anonymous)
              </p>

              {/* history is admin-gated: show the request path when hidden */}
              {detail.history?.allowed === false ? (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                  <p className="text-[11px] font-semibold text-amber-800">
                    {detail.history.pastCount > 0
                      ? `${detail.history.pastCount} previous call note(s) are hidden by Admin.`
                      : "No previous call notes are visible for your role."}
                  </p>
                  <p className="mt-0.5 text-[10px] text-amber-700">
                    Request access from HR/Admin to read past agent notes on this lead.
                  </p>
                  {detail.history.requests?.map((r) => (
                    <p key={r.id} className="mt-1 rounded bg-white/70 px-1.5 py-1 text-[10px] text-amber-800">
                      Request #{r.id}: <strong>{r.status}</strong>
                      {r.resolvedNote ? ` · ${r.resolvedNote}` : ""} · {timeAgo(r.createdAt)}
                    </p>
                  ))}
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 w-full border-amber-300 bg-white"
                    onClick={() => setHistReasOpen(true)}
                    disabled={detail.history.requests?.some((r) => r.status === "PENDING")}
                  >
                    <HistoryIcon className="h-3.5 w-3.5" />
                    {detail.history.requests?.some((r) => r.status === "PENDING") ? "Access pending…" : "Request History Access"}
                  </Button>
                </div>
              ) : null}

              <div className="mt-2 space-y-2">
                {detail.history?.allowed === false ? (
                  <p className="rounded-lg bg-slate-50 p-2 text-[11px] italic text-muted-foreground">
                    Past agent notes are private. Identities of previous agents are always masked.
                  </p>
                ) : null}
                {detail.history?.allowed !== false && detail.pastNotes.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No previous call notes — you are the first agent on this lead.</p>
                ) : null}
                {detail.history?.allowed !== false
                  ? detail.pastNotes.map((n) => (
                      <div key={n.id} className="rounded-lg bg-slate-50 p-2">
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                          <span className="font-semibold text-slate-600">Agent #A{n.id.toString().padStart(3, "0")}</span>
                          <span>
                            {timeAgo(n.createdAt)} · {n.durationSeconds}s
                          </span>
                        </div>
                        <p className="mt-1 text-xs">{n.notes ?? "— no note —"}</p>
                        <Badge variant="muted" className="mt-1">
                          {n.status.replace("_", " ")}
                        </Badge>
                      </div>
                    ))
                  : null}
              </div>
              {detail.myLogs.length ? (
                <div className="mt-3 border-t pt-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Your logs</p>
                  {detail.myLogs.map((n) => (
                    <p key={n.id} className="mt-1 text-xs">
                      <span className="font-semibold">{n.status.replace("_", " ")}</span> · {n.notes ?? "—"} · {dateTime(n.createdAt)}
                    </p>
                  ))}
                </div>
              ) : null}
            </section>

            {/* whatsapp templates */}
            <section className="rounded-xl border bg-white p-3 sm:p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">WhatsApp templates</p>
              <div className="mt-2 space-y-2">
                <NativeSelect value={templateId} onChange={(e) => setTemplateId(Number(e.target.value))} disabled={locked}>
                  {detail.templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </NativeSelect>
                <Textarea readOnly value={message} className="min-h-[170px] bg-slate-50 text-sm leading-relaxed sm:text-xs" />
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Button
                    variant="outline"
                    onClick={async () => {
                      await navigator.clipboard.writeText(message);
                      toast.success("Message copied");
                    }}
                  >
                    <Copy className="h-4 w-4" /> Copy text
                  </Button>
                  <Button
                    variant="whatsapp"
                    disabled={locked}
                    onClick={async () => {
                      whatsappSentRef.current = true;
                      void trackLeadOpen(leadId, "WHATSAPP");
                      trackAction(`whatsapp-template:${templateId}`);
                      await post({ action: "whatsapp-sent", templateId, templateTitle: detail.templates.find((t) => t.id === templateId)?.title });
                      window.open(waLink(dialNumber ?? "", message), "_blank");
                    }}
                  >
                    <Send className="h-4 w-4" /> Send via WhatsApp
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Placeholders like {"{business_name}"} and {"{reviews_count}"} are auto-filled from this lead.
                </p>
              </div>
            </section>

            {/* ── SINGLE payment proof input · only when status = Payment Approval ── */}
            {showProofSection ? (
              <section className="rounded-xl border border-violet-200 bg-white p-3 sm:p-4">
                {detail.lastRejection ? (
                  <div className="mb-2 rounded-lg border border-rose-200 bg-rose-50 p-2.5">
                    <p className="flex items-center gap-1.5 text-[11px] font-bold text-rose-800">
                      <XCircle className="h-3.5 w-3.5" /> Proof rejected — re-upload required
                    </p>
                    <p className="mt-1 text-[11px] text-rose-700">
                      {detail.lastRejection.rejectionReason ?? detail.lastRejection.reviewNote ?? "No reason recorded."}
                    </p>
                  </div>
                ) : null}

                <p className="flex items-center justify-between gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <ImagePlus className="h-3.5 w-3.5" /> Payment Proof
                  </span>
                  {detail.lastRejection ? <Badge variant="danger">rejected</Badge> : <Badge variant="outline">required</Badge>}
                </p>

                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void upload(file);
                  }}
                />

                {/* one file input row */}
                <label
                  className={cn(
                    "mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed px-3 py-4 text-sm font-medium transition",
                    proofUrl ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-violet-300 bg-violet-50/50 text-violet-700",
                    (uploading || locked) && "pointer-events-none opacity-60",
                  )}
                >
                  <ImagePlus className="h-4 w-4 shrink-0" />
                  <span className="truncate">
                    {uploading ? "Uploading…" : proofUrl ? "Proof attached — tap to change" : "Tap to attach screenshot"}
                  </span>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void upload(file);
                    }}
                  />
                </label>

                {proofUrl ? (
                  <button
                    onClick={() => setPreview({ url: proofUrl!, label: `${headerTitle} payment proof` })}
                    className="mt-2 flex w-full items-center gap-2 rounded-lg border p-2 text-left"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <SafeImage src={proofUrl} alt="Payment proof" className="h-14 w-14 shrink-0 rounded object-cover" />
                    <span className="min-w-0 flex-1 text-[11px] text-muted-foreground">
                      <span className="block font-semibold text-slate-700">Proof attached</span>
                      <span className="block truncate">Tap to view &amp; zoom</span>
                    </span>
                    <Eye className="h-4 w-4 shrink-0 text-blue-600" />
                  </button>
                ) : (
                  <p className="mt-2 rounded-lg bg-violet-50 px-2 py-1.5 text-[10px] font-medium text-violet-700">
                    A screenshot is required before sending for Payment Approval.
                  </p>
                )}

                {detail.lastRejection ? (
                  <Button
                    className="mt-2 w-full"
                    disabled={!proofUrl || busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await post({
                          action: "reupload-proof",
                          uploadId: uploadedId,
                          proofUrl,
                          paymentNote: paymentNote || notes,
        callStatus: callOutcome,
                          dealAmount: dealAmount ? Number(dealAmount) : undefined,
                        });
                        toast.success("Proof re-submitted for approval");
                        await load();
                        onChanged();
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : "Failed");
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <RefreshCcw className="h-4 w-4" /> Re-upload Proof
                  </Button>
                ) : null}
              </section>
            ) : null}

            {/* status update */}
            <section className="rounded-xl border bg-white p-3 sm:p-4">
              <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                <BadgeCheck className="h-3.5 w-3.5" /> Status update &amp; call notes
              </p>
              {alreadySubmitted ? (
                <div className="mt-2 space-y-2">
                  <div className="rounded-lg bg-emerald-50 p-3 text-xs text-emerald-800">
                    <p className="font-semibold">Report submitted &amp; locked 🔒</p>
                    <p className="mt-1">This form is now read-only. Made a mistake? Raise a correction request below.</p>
                  </div>
                  {detail.lastRejection ? (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                      <p className="text-xs font-bold text-rose-800">Proof rejected by Admin/HR</p>
                      <p className="mt-1 text-[11px] text-rose-700">
                        {detail.lastRejection.rejectionReason ?? detail.lastRejection.reviewNote ?? "No reason recorded."}
                      </p>
                      <Button size="sm" variant="destructive" className="mt-2 w-full" onClick={() => setRejectionOpen(true)}>
                        <XCircle className="h-3.5 w-3.5" /> View comments &amp; re-upload proof
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="mt-2 space-y-2">
                  <NativeSelect value={status} onChange={(e) => setStatus(e.target.value)}>
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </NativeSelect>

                  {/* single Call Notes / Reason box — appended to the audit timeline */}
                  <div className="space-y-1">
                    <Label>
                      {statusChanged ? (
                        <>
                          <span className="font-semibold text-slate-700">Call Notes / Reason</span>
                          <span className="ml-1 font-normal text-muted-foreground">
                            ({statusVal.replace("_", " ")} → {status.replace("_", " ")})
                          </span>
                        </>
                      ) : (
                        "Call Notes / Reason"
                      )}
                    </Label>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder={
                        status === "PAYMENT_APPROVAL"
                          ? "e.g. Client paid the advance, screenshot attached, deal value 25000."
                          : "What did the prospect say? Next action, best time to call back…"
                      }
                    />
                  </div>

                  {/* ── Payment Approval flow: deal value + optional agent note ── */}
                  {status === "PAYMENT_APPROVAL" ? (
                    <div className="space-y-2 rounded-xl border border-violet-200 bg-violet-50/60 p-2.5">
                      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-violet-800">
                        <IndianRupee className="h-3.5 w-3.5" /> Payment details
                      </p>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label htmlFor="dealValue">Deal Value (customer paid)</Label>
                          <div className="relative">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">
                              ₹
                            </span>
                            <NumberInput
                              id="dealValue"
                              value={dealAmount}
                              onValueChange={setDealAmount}
                              placeholder="25000"
                              className="pl-7"
                            />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="agentNote">Your Note (optional)</Label>
                          <Input
                            id="agentNote"
                            value={paymentNote}
                            onChange={(e) => setPaymentNote(e.target.value)}
                            placeholder="UPI ref 4821XXXX"
                          />
                        </div>
                      </div>
                      {!proofUrl ? (
                        <p className="rounded-lg bg-white px-2 py-1 text-[10px] font-medium text-violet-700">
                          ⚠ Attach the payment screenshot below to enable submission.
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {/* ── Call Outcome: ONLY when status is In Process ── */}
                  {status === "IN_PROGRESS" ? (
                    <div className="space-y-1">
                      <Label htmlFor="callOutcome">Call Outcome</Label>
                      <NativeSelect
                        id="callOutcome"
                        value={callOutcome}
                        onChange={(e) => setCallOutcome(e.target.value)}
                      >
                        {["Connected", "No Answer", "Switched Off", "Busy", "Wrong Number", "Not Dialed"].map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                  ) : null}

                  {/* ── Callback date & time: ONLY when status is Call Back ── */}
                  {status === "CALLBACK" ? (
                    <div className="space-y-1.5 rounded-xl border border-amber-200 bg-amber-50/70 p-2.5">
                      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-800">
                        <CalendarClock className="h-3.5 w-3.5" /> Schedule Callback
                      </p>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label htmlFor="callbackDate">Callback date</Label>
                          <Input
                            id="callbackDate"
                            type="date"
                            value={callbackDate}
                            min={new Date().toISOString().slice(0, 10)}
                            onChange={(e) => setCallbackDate(e.target.value)}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="callbackTime">Callback time</Label>
                          <Input
                            id="callbackTime"
                            type="time"
                            value={callbackTime}
                            onChange={(e) => setCallbackTime(e.target.value)}
                          />
                        </div>
                      </div>
                      <p className="text-[10px] text-amber-700">
                        {callbackDate && callbackTime
                          ? `Lead moves to Call back — reminder set for ${callbackDate} at ${callbackTime}.`
                          : "Pick a date and time so the callback is not missed."}
                      </p>
                    </div>
                  ) : null}
                  <Button
                    size="lg"
                    className="w-full"
                    onClick={() => void submitReport()}
                    disabled={!canSubmit}
                  >
                    <Clock className="h-4 w-4" /> Submit &amp; lock report {callActive ? `· ${hms(duration)}` : ""}
                  </Button>
                  {needsCallback && !(callbackDate && callbackTime) ? (
                    <p className="text-[10px] font-medium text-amber-700">
                      Select a callback date and time before submitting.
                    </p>
                  ) : null}
                </div>
              )}

              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Button variant="outline" onClick={() => setCorrectionOpen(true)}>
                  <RefreshCcw className="h-4 w-4" /> Request correction
                </Button>
                <Button variant="secondary" onClick={() => setReplaceOpen(true)}>
                  <Repeat className="h-4 w-4" /> Request Replace Lead
                </Button>
                <Button variant="destructive" onClick={() => setErrorOpen(true)}>
                  <TriangleAlert className="h-4 w-4" /> Report Lead Error
                </Button>
                <Button variant="ghost" className="border border-stone-300 text-stone-700" onClick={() => setLostOpen(true)}>
                  <Undo2 className="h-4 w-4" /> Remove Lead / I Lost My Efforts
                </Button>
              </div>

              {detail.correction.length ? (
                <div className="mt-2 space-y-1">
                  {detail.correction.map((c) => (
                    <p key={c.id} className="rounded-lg bg-slate-50 px-2 py-1 text-[11px] text-muted-foreground">
                      {c.status}: {c.reason} · {timeAgo(c.createdAt)}
                    </p>
                  ))}
                </div>
              ) : null}
            </section>
          </div>
        </DialogContent>
      </Dialog>

      {/* image preview with zoom */}
      <Sheet open={Boolean(preview)} onOpenChange={(v) => !v && setPreview(null)} title="Uploaded proof preview" description="Pinch/zoom controls">
        <div className="space-y-3">
          <div className="overflow-auto rounded-xl border bg-slate-50 p-2 thin-scroll">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview.url}
                alt={preview.label}
                style={{ transform: `scale(${zoom})` }}
                className="mx-auto max-w-full origin-top transition-transform"
              />
            ) : null}
          </div>
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
              −
            </Button>
            <span className="w-16 text-center text-xs">{Math.round(zoom * 100)}%</span>
            <Button variant="outline" size="sm" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
              +
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setZoom(1)}>
              Reset
            </Button>
          </div>
        </div>
      </Sheet>

      {/* request history access */}
      <Sheet
        open={histReasOpen}
        onOpenChange={setHistReasOpen}
        title="Request History Access"
        description="HR/Admin will review your request to reveal past call notes on this lead."
      >
        <div className="space-y-2">
          <Label>Why do you need the past notes?</Label>
          <Textarea
            value={histReason}
            onChange={(e) => setHistReason(e.target.value)}
            placeholder="Prospect referenced a previous conversation — I need context to avoid repeating the same pitch."
          />
          <Button
            className="w-full"
            disabled={histReason.trim().length < 5}
            onClick={async () => {
              try {
                await post({ action: "history-access", reason: histReason.trim() });
                toast.success("History access requested");
                setHistReasOpen(false);
                setHistReason("");
                await load();
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Failed");
              }
            }}
          >
            <HistoryIcon className="h-4 w-4" /> Send request
          </Button>
        </div>
      </Sheet>

      {/* request replace lead */}
      <Sheet
        open={replaceOpen}
        onOpenChange={setReplaceOpen}
        title="Request Replace Lead"
        description={`Lead ${F("lead_code") ?? `#${detail.lead.id}`} returns to the pool and a fresh lead is assigned to you.`}
      >
        <div className="space-y-2">
          <div className="rounded-lg bg-slate-50 p-2 text-xs">
            <p className="font-semibold">{headerTitle}</p>
            <p className="text-muted-foreground">
              {F("city_keyword") ?? "—"} · {F("niche_category") ?? "—"} · current status {statusVal.replace("_", " ")}
            </p>
          </div>
          <Label>
            <span className="font-semibold text-rose-700">Reason for Replacement *</span>
          </Label>
          <Textarea
            value={replaceReason}
            onChange={(e) => setReplaceReason(e.target.value)}
            placeholder="Number switched off after 4 attempts across 3 days, language barrier, prospect asked never to be called…"
          />
          <p className="text-[10px] text-muted-foreground">
            Sent to Admin / HR / Manager for approval. Minimum 10 characters so reviewers have context.
          </p>
          <Button
            className="w-full"
            disabled={replaceReason.trim().length < 10}
            onClick={async () => {
              try {
                await post({ action: "replace-lead", reason: replaceReason.trim() });
                toast.success("Replacement requested — awaiting approval");
                setReplaceOpen(false);
                setReplaceReason("");
                onClose();
                onChanged();
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Failed");
              }
            }}
          >
            <Repeat className="h-4 w-4" /> Submit replacement request
          </Button>
        </div>
      </Sheet>

      {/* rejection detail */}
      <Sheet
        open={rejectionOpen}
        onOpenChange={setRejectionOpen}
        title="Proof rejection notes"
        description="Feedback from Admin / HR on your payment proof"
      >
        <div className="space-y-2">
          {detail.lastRejection ? (
            <>
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                <p className="text-xs font-bold text-rose-800">Rejection reason</p>
                <p className="mt-1 text-xs text-rose-700">
                  {detail.lastRejection.rejectionReason ?? detail.lastRejection.reviewNote ?? "No reason recorded."}
                </p>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Deal value {inr(detail.lastRejection.amount)}
                {detail.lastRejection.decidedAt ? ` · reviewed ${dateTime(detail.lastRejection.decidedAt)}` : ""}
              </p>
              <Button
                className="w-full"
                onClick={() => {
                  setRejectionOpen(false);
                  fileRef.current?.click();
                }}
              >
                <ImagePlus className="h-4 w-4" /> Re-upload Proof
              </Button>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">No rejection recorded for this lead.</p>
          )}
        </div>
      </Sheet>

      {/* I lost my efforts -> Lost / Returned to Pool */}
      <Sheet
        open={lostOpen}
        onOpenChange={setLostOpen}
        title="Remove Lead — I Lost My Efforts"
        description="The lead leaves your queue and moves to the “Lost / Returned to Pool” stage for management review."
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setLostOpen(false)}>
              Keep the lead
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              disabled={lostReason.trim().length < 10 || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await post({ action: "lost-lead", reason: lostReason.trim() });
                  toast.success("Lead returned to the pool");
                  setLostOpen(false);
                  setLostReason("");
                  onClose();
                  onChanged();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed");
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Undo2 className="h-4 w-4" /> Return lead to pool
            </Button>
          </div>
        }
      >
        <div className="space-y-2">
          <div className="rounded-lg bg-stone-50 p-2 text-xs">
            <p className="font-semibold">{headerTitle}</p>
            <p className="text-muted-foreground">
              {F("lead_code") ?? `#${detail.lead.id}`} · {F("city_keyword") ?? "—"} · currently {statusVal.replace("_", " ")}
            </p>
          </div>
          <div className="space-y-1">
            <Label>
              <span className="font-semibold text-rose-700">Why are you giving up on this lead? *</span>
            </Label>
            <Textarea
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value)}
              placeholder="Number unreachable after 6 attempts across 4 days / business relocated out of my territory / gatekeeper blocks every call…"
            />
            <p className="text-[10px] text-muted-foreground">
              Minimum 10 characters. This is logged against your name so managers can review pool-return patterns.
            </p>
          </div>
        </div>
      </Sheet>

      {/* report lead error */}
      <Sheet
        open={errorOpen}
        onOpenChange={setErrorOpen}
        title="Report Lead Error"
        description="Goes straight to the Admin / HR / Manager Lead Errors queue for review."
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setErrorOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              disabled={errorDetails.trim().length < 10}
              onClick={async () => {
                try {
                  await post({
                    action: "report-error",
                    category: errorCategory,
                    details: errorDetails.trim(),
                    proofUrl: errorProof,
                  });
                  toast.success("Error report sent to management");
                  setErrorOpen(false);
                  setErrorDetails("");
                  setErrorProof(null);
                  await load();
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed");
                }
              }}
            >
              <TriangleAlert className="h-4 w-4" /> Submit error report
            </Button>
          </div>
        }
      >
        <div className="space-y-2">
          <div className="rounded-lg bg-slate-50 p-2 text-xs">
            <p className="font-semibold">{headerTitle}</p>
            <p className="text-muted-foreground">
              {F("lead_code") ?? `#${detail.lead.id}`} · {F("city_keyword") ?? "—"} · {F("phone") ?? "—"}
            </p>
          </div>
          <div className="space-y-1">
            <Label>Issue type</Label>
            <NativeSelect value={errorCategory} onChange={(e) => setErrorCategory(e.target.value)}>
              {[
                ["WRONG_NUMBER", "Wrong / Invalid Number"],
                ["DUPLICATE", "Duplicate Lead"],
                ["CLOSED_BUSINESS", "Business Permanently Closed"],
                ["WRONG_DATA", "Incorrect Business Data"],
                ["DO_NOT_CALL", "Asked Not To Be Called"],
                ["OTHER", "Other Issue"],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label>Issue details *</Label>
            <Textarea
              value={errorDetails}
              onChange={(e) => setErrorDetails(e.target.value)}
              placeholder="Number is switched off permanently / shop boarded up / name does not match the listing…"
            />
            <p className="text-[10px] text-muted-foreground">Minimum 10 characters so reviewers have context.</p>
          </div>
          <div className="space-y-1">
            <Label>Proof (optional)</Label>
            <input
              ref={errorFileRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const fd = new FormData();
                fd.append("file", f);
                fd.append("kind", "LEAD_ERROR");
                const res = await fetch("/api/upload", { method: "POST", body: fd });
                const json = (await res.json()) as { url?: string; error?: string };
                if (res.ok && json.url) {
                  setErrorProof(json.url);
                  toast.success("Proof attached");
                } else toast.error(json.error ?? "Upload failed");
              }}
            />
            <Button variant="outline" className="w-full" onClick={() => errorFileRef.current?.click()}>
              <ImagePlus className="h-4 w-4" /> {errorProof ? "Attached — replace" : "Attach screenshot"}
            </Button>
          </div>
        </div>
      </Sheet>

      {/* correction request */}
      <Sheet
        open={correctionOpen}
        onOpenChange={setCorrectionOpen}
        title="Request status correction"
        description="Goes to Admin / HR for review — your report stays locked until then"
      >
        <div className="space-y-2">
          <Label>What went wrong?</Label>
          <Textarea
            value={correctionReason}
            onChange={(e) => setCorrectionReason(e.target.value)}
            placeholder="Selected wrong status by mistake / typed wrong amount…"
          />
          <Button
            className="w-full"
            disabled={correctionReason.trim().length < 5}
            onClick={async () => {
              try {
                await post({ action: "correction", reason: correctionReason.trim(), requestedStatus: status });
                toast.success("Correction request sent");
                setCorrectionOpen(false);
                setCorrectionReason("");
                await load();
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Failed");
              }
            }}
          >
            Submit correction request
          </Button>
        </div>
      </Sheet>
    </>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}

function statusChip(status: string) {
  switch (status) {
    case "IN_PROGRESS":
      return "bg-blue-50 text-blue-700 border-blue-200";
    case "CALLBACK":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "PAYMENT_APPROVAL":
      return "bg-violet-50 text-violet-700 border-violet-200";
    case "REJECTED":
      return "bg-rose-50 text-rose-700 border-rose-200";
    default:
      return "bg-slate-100 text-slate-700 border-slate-200";
  }
}

function LinkRow({ label, value, masked }: { label: string; value: string | null; masked?: boolean }) {
  if (!value) return null;
  if (masked) {
    return (
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <span className="w-24 shrink-0 text-[10px] uppercase tracking-wide">{label}</span>
        <span className="rounded bg-amber-50 px-1.5 py-0.5 font-mono font-semibold text-amber-700">{value}</span>
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1 text-[11px]">
      <span className="w-24 shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <a
        href={value.startsWith("http") ? value : `https://${value}`}
        target="_blank"
        rel="noreferrer"
        className="truncate text-blue-600 underline decoration-dotted"
      >
        {value.replace(/^https?:\/\//, "")}
      </a>
    </p>
  );
}
