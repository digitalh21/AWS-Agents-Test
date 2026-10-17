"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eraser, Loader2, MessageSquare, Trash2, Paperclip, Plus, RefreshCcw, Send, Ticket as TicketIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, Input, Label, NativeSelect, SectionCard, Stat, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/dialog";
import { OpenLeadButton } from "@/components/shared/lead-peek";
import { cn, dateTime, timeAgo } from "@/lib/utils";

type Ticket = {
  id: number;
  leadId?: number | null;
  ticketNumber: string;
  category: string;
  subject: string;
  details: string;
  proofUrl: string | null;
  status: string;
  priority: string;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
  agentName?: string;
  agentEmail?: string;
  agentRole?: string;
  messages?: number;
  unread?: number;
};

type Message = {
  id: number;
  fromUserId: string;
  body: string;
  attachmentUrl: string | null;
  createdAt: string;
  senderName: string;
  senderRole: string;
};

const STATUS_TONE: Record<string, "warn" | "default" | "success" | "danger" | "muted"> = {
  OPEN: "warn",
  IN_PROGRESS: "default",
  WAITING_AGENT: "default",
  RESOLVED: "success",
  REJECTED: "danger",
};

export function TicketDesk({ isStaff = false }: { isStaff?: boolean }) {
  const [rows, setRows] = useState<Ticket[]>([]);
  const [counts, setCounts] = useState({ open: 0, inProgress: 0, waiting: 0, resolved: 0, total: 0 });
  const [categories, setCategories] = useState<Array<{ value: string; label: string }>>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [viewer, setViewer] = useState<{ id: string; isStaff: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState("ALL");
  // Unified "Support & Requests" segments: complaints + helpdesk filter the
  // tickets list; requests shows the lead/message request inbox.
  const [segment, setSegment] = useState<"complaints" | "helpdesk" | "requests">("complaints");
  const [requests, setRequests] = useState<
    Array<{
      id: number;
      kind: string;
      leadId: number | null;
      businessName: string | null;
      leadCode: string | null;
      quantity: number;
      reason: string | null;
      note: string | null;
      status: string;
      createdAt: string;
      userName?: string | null;
    }>
  >([]);
  const requestsLoaded = useRef(false);

  const SEGMENT_BUCKETS: Record<"complaints" | "helpdesk", string[]> = {
    complaints: ["LEAD_ISSUE", "TECHNICAL", "OTHER"],
    helpdesk: ["ACCESS_ISSUE", "DATA_CORRECTION", "PAYOUT_QUERY"],
  };
  const bucketFor = (category: string) =>
    SEGMENT_BUCKETS.complaints.includes(category)
      ? "complaints"
      : SEGMENT_BUCKETS.helpdesk.includes(category)
        ? "helpdesk"
        : "complaints";
  const visibleRows = segment === "requests" ? [] : rows.filter((t) => bucketFor(t.category) === segment);

  const [form, setForm] = useState({ category: "ACCESS_ISSUE", subject: "", details: "" });
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // active ticket thread
  const [activeId, setActiveId] = useState<number | null>(null);
  const [thread, setThread] = useState<{ ticket: Ticket; messages: Message[] } | null>(null);
  const [reply, setReply] = useState("");
  const [statusDraft, setStatusDraft] = useState("IN_PROGRESS");
  const [resolutionDraft, setResolutionDraft] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/tickets?scope=${scope}`);
    if (res.ok) {
      const json = (await res.json()) as {
        rows: Ticket[];
        counts: typeof counts;
        categories: Array<{ value: string; label: string }>;
        statuses: string[];
        viewer: { id: string; isStaff: boolean };
      };
      setRows(json.rows ?? []);
      setCounts(json.counts);
      setCategories(json.categories ?? []);
      setStatuses(json.statuses ?? []);
      setViewer(json.viewer);
    }
    setLoading(false);
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  // lazy-load the request inbox the first time the Requests segment opens
  useEffect(() => {
    if (segment !== "requests" || requestsLoaded.current) return;
    requestsLoaded.current = true;
    void (async () => {
      const res = await fetch("/api/leads/requests?scope=ALL");
      if (res.ok) {
        const json = (await res.json()) as {
          rows?: typeof requests;
          mine?: typeof requests;
          replaces?: Array<(typeof requests)[number] & { agentName?: string | null }>;
        };
        const raw = json.replaces ?? json.rows ?? json.mine ?? [];
        setRequests(
          raw.map((r) => ({
            ...r,
            userName: r.userName ?? ("agentName" in r ? (r.agentName as string | null) : null),
          })),
        );
      }
    })();
  }, [segment, load]);

  const loadThread = useCallback(async (id: number) => {
    const res = await fetch(`/api/tickets?id=${id}`);
    if (res.ok) setThread(await res.json());
  }, []);

  useEffect(() => {
    if (!activeId) return;
    void loadThread(activeId);
    const timer = setInterval(() => void loadThread(activeId), 10000);
    return () => clearInterval(timer);
  }, [activeId, loadThread]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread?.messages.length]);

  async function uploadProof(file: File) {
    const body = new FormData();
    body.append("file", file);
    body.append("kind", "TICKET_PROOF");
    const res = await fetch("/api/upload", { method: "POST", body });
    const json = (await res.json()) as { url?: string; error?: string };
    if (!res.ok || !json.url) {
      toast.error(json.error ?? "Upload failed");
      return;
    }
    setProofUrl(json.url);
    toast.success("Attachment ready");
  }

  async function submit() {
    setBusy(true);
    const res = await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, proofUrl }),
    });
    const json = (await res.json()) as { error?: string; ticket?: Ticket };
    if (res.ok) {
      toast.success(`Ticket ${json.ticket?.ticketNumber} created`);
      setOpen(false);
      setForm({ category: form.category, subject: "", details: "" });
      setProofUrl(null);
      await load();
    } else toast.error(json.error ?? "Could not create ticket");
    setBusy(false);
  }

  async function sendReply() {
    if (!activeId || (!reply.trim() && !proofUrl)) return;
    setBusy(true);
    const res = await fetch("/api/tickets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: activeId, message: reply.trim(), attachmentUrl: proofUrl }),
    });
    if (res.ok) {
      setReply("");
      await loadThread(activeId);
      await load();
    } else toast.error("Could not send");
    setBusy(false);
  }

  /** Remove / Clear Chat — wipes the thread but keeps the ticket for reference. */
  async function clearChat() {
    if (!activeId) return;
    if (!window.confirm("Clear the entire chat history for this ticket? This cannot be undone.")) return;
    setBusy(true);
    const res = await fetch(`/api/tickets?id=${activeId}&scope=messages`, { method: "DELETE" });
    const json = (await res.json()) as { error?: string };
    if (res.ok) {
      toast.success("Chat history cleared");
      await loadThread(activeId);
      await load();
    } else toast.error(json.error ?? "Could not clear chat");
    setBusy(false);
  }

  /** Staff-only: remove the ticket entirely. */
  async function removeTicket() {
    if (!activeId) return;
    if (!window.confirm("Delete this ticket and its conversation permanently?")) return;
    setBusy(true);
    const res = await fetch(`/api/tickets?id=${activeId}&scope=ticket`, { method: "DELETE" });
    const json = (await res.json()) as { error?: string };
    if (res.ok) {
      toast.success("Ticket deleted");
      setActiveId(null);
      setThread(null);
      await load();
    } else toast.error(json.error ?? "Delete failed");
    setBusy(false);
  }

  async function updateTicket(patch: Record<string, unknown>) {
    if (!activeId) return;
    setBusy(true);
    const res = await fetch("/api/tickets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: activeId, ...patch }),
    });
    if (res.ok) {
      toast.success("Ticket updated");
      await loadThread(activeId);
      await load();
    } else toast.error("Update failed");
    setBusy(false);
  }

  const statusLabel = (s: string) => s.replace(/_/g, " ");

  return (
    <div className="space-y-3 p-3 sm:p-4 lg:p-6">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <Stat label="Open" value={counts.open} tone="warn" />
        <Stat label="In progress" value={counts.inProgress} tone="info" />
        <Stat label="Awaiting you" value={counts.waiting} tone="default" />
        <Stat label="Resolved" value={counts.resolved} tone="success" />
        <Stat label="Total" value={counts.total} />
      </div>

      <SectionCard
        title="Support & Requests"
        icon={<TicketIcon className="h-3.5 w-3.5" />}
        action={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => void load()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setForm((f) => ({ ...f, category: categories[0]?.value ?? "ACCESS_ISSUE" }));
                setOpen(true);
              }}
            >
              <Plus className="h-4 w-4" /> New Ticket
            </Button>
          </div>
        }
      >
        {/* unified internal segments: Complaints / Helpdesk / Requests */}
        <div className="mb-2 flex gap-1 rounded-xl border bg-white p-1">
          {(
            [
              { key: "complaints", label: "Complaints", n: rows.filter((t) => bucketFor(t.category) === "complaints").length },
              { key: "helpdesk", label: "Helpdesk", n: rows.filter((t) => bucketFor(t.category) === "helpdesk").length },
              { key: "requests", label: "Requests", n: segment === "requests" ? requests.length : null },
            ] as const
          ).map((g) => (
            <button
              key={g.key}
              onClick={() => setSegment(g.key)}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition",
                segment === g.key ? "bg-blue-700 text-white shadow" : "text-slate-500 hover:bg-slate-50",
              )}
            >
              {g.label}
              {g.n !== null ? (
                <span className={cn("rounded-full px-1.5 py-0.5 text-[9px]", segment === g.key ? "bg-white/20" : "bg-slate-100")}>{g.n}</span>
              ) : null}
            </button>
          ))}
        </div>

        {segment !== "requests" ? (
        <div className="mb-2 flex gap-1.5 overflow-x-auto no-scrollbar">
          {["ALL", "OPEN", "IN_PROGRESS", "WAITING_AGENT", "RESOLVED"].map((sc) => (
            <button
              key={sc}
              onClick={() => setScope(sc)}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-semibold",
                scope === sc ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600",
              )}
            >
              {sc === "ALL" ? "All" : statusLabel(sc)}
            </button>
          ))}
        </div>
        ) : null}

        {segment === "requests" ? (
          <div className="space-y-2">
            {requests.length === 0 ? (
              <EmptyState
                title="No requests"
                hint="Lead allocation / replacement requests appear here, with management's decision status."
                icon="📨"
              />
            ) : null}
            {requests.map((r) => (
              <div key={r.id} className="rounded-xl border bg-white p-3 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-bold">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600">
                        {r.kind === "REPLACE_LEAD" ? "Replace lead" : r.kind === "NEW_LEADS" ? "New leads" : r.kind.replaceAll("_", " ")}
                      </span>
                      {r.businessName ? <span className="truncate">· {r.businessName}</span> : null}
                      {r.quantity ? <span className="text-[11px] text-muted-foreground">× {r.quantity}</span> : null}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{r.reason ?? r.note ?? ""}</p>
                    {r.userName ? <p className="mt-1 text-[10px] text-muted-foreground">{r.userName}</p> : null}
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{timeAgo(r.createdAt)}</p>
                  </div>
                  <Badge variant={STATUS_TONE[r.status] ?? "muted"}>{statusLabel(r.status)}</Badge>
                </div>
              </div>
            ))}
          </div>
        ) : visibleRows.length === 0 && !loading ? (
          <EmptyState
            title={segment === "complaints" ? "No complaints" : "No helpdesk tickets"}
            hint={
              segment === "complaints"
                ? "Lead issues, technical problems and other complaints land here."
                : "Access issues, payout queries and data corrections land here."
            }
            icon="🎫"
          />
        ) : null}

        <div className="space-y-2">
          {visibleRows.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveId(t.id)}
              className="block w-full rounded-xl border bg-white p-3 text-left shadow-sm transition active:scale-[0.99]"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-bold">
                    <span className="font-mono text-[11px] text-blue-700">#{t.ticketNumber}</span>
                    <span className="truncate">{t.subject}</span>
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{t.details}</p>
              {t.leadId ? (
                <span className="mt-1 inline-block">
                  <OpenLeadButton leadId={t.leadId} isStaff={Boolean(isStaff)} label="Open related lead" />
                </span>
              ) : null}
                  {isStaff ? (
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {t.agentName} · {t.agentEmail} · {timeAgo(t.createdAt)}
                    </p>
                  ) : (
                    <p className="mt-1 text-[10px] text-muted-foreground">Updated {timeAgo(t.updatedAt)}</p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge variant={STATUS_TONE[t.status] ?? "muted"}>{statusLabel(t.status)}</Badge>
                  <span className="text-[10px] text-muted-foreground">
                    {t.messages ?? 0} msg{(t.messages ?? 0) === 1 ? "" : "s"}
                  </span>
                </div>
              </div>
              {(t.unread ?? 0) > 0 ? (
                <p className="mt-1.5 inline-block rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white">
                  {t.unread} new reply
                </p>
              ) : null}
            </button>
          ))}
        </div>
      </SectionCard>

      {/* ---------- new ticket sheet ---------- */}
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Raise a Complaint / Request"
        description="A unique ticket number is generated automatically and routed to Admin, HR and Manager."
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button className="flex-1" disabled={busy || form.subject.trim().length < 4 || form.details.trim().length < 10} onClick={() => void submit()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <TicketIcon className="h-4 w-4" />} Submit ticket
            </Button>
          </div>
        }
      >
        <div className="space-y-2">
          <div className="space-y-1">
            <Label>Category *</Label>
            <NativeSelect value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {categories.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label>Subject *</Label>
            <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Cannot access my leads" />
          </div>
          <div className="space-y-1">
            <Label>Issue details *</Label>
            <Textarea
              value={form.details}
              onChange={(e) => setForm({ ...form, details: e.target.value })}
              placeholder="Since this morning my Call back bucket shows empty but I still have 12 leads pending…"
            />
          </div>
          <div className="space-y-1">
            <Label>Attachment / proof (optional)</Label>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadProof(f);
              }}
            />
            <Button variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>
              <Paperclip className="h-4 w-4" /> {proofUrl ? "Attached — replace" : "Attach screenshot / file"}
            </Button>
            {proofUrl ? (
              <p className="truncate rounded-lg bg-emerald-50 px-2 py-1 text-[10px] text-emerald-700">Attached: {proofUrl}</p>
            ) : null}
          </div>
        </div>
      </Sheet>

      {/* ---------- ticket thread ---------- */}
      <Sheet
        open={Boolean(activeId)}
        onOpenChange={(v) => !v && setActiveId(null)}
        title={thread ? `#${thread.ticket.ticketNumber} — ${thread.ticket.subject}` : "Ticket"}
        description={thread ? `${thread.ticket.category.replace(/_/g, " ")} · opened ${dateTime(thread.ticket.createdAt)}` : ""}
        footer={
          <div className="flex items-center gap-2">
            <Input
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void sendReply();
              }}
              placeholder={isStaff ? "Reply to the agent…" : "Add more detail…"}
            />
            <Button size="icon" disabled={busy} onClick={() => void sendReply()} aria-label="Send">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        }
      >
        {thread ? (
          <div className="space-y-3">
            {/* ticket meta */}
            <div className="rounded-xl border p-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={STATUS_TONE[thread.ticket.status] ?? "muted"}>{statusLabel(thread.ticket.status)}</Badge>
                <Badge variant="outline">{thread.ticket.priority}</Badge>
                <span className="text-[10px] text-muted-foreground">by {thread.ticket.agentName}</span>
              </div>
              <p className="mt-1.5 text-xs">{thread.ticket.details}</p>
              {thread.ticket.leadId ? (
                <span className="mt-1.5 block">
                  <OpenLeadButton leadId={thread.ticket.leadId} isStaff={Boolean(isStaff)} label="Open related lead" />
                </span>
              ) : null}
              {thread.ticket.proofUrl ? (
                <a href={thread.ticket.proofUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[11px] text-blue-600 underline">
                  View attachment
                </a>
              ) : null}
            </div>

            {/* staff controls */}
            {isStaff ? (
              <div className="space-y-2 rounded-xl border border-blue-200 bg-blue-50/60 p-2.5">
                <p className="text-[11px] font-bold uppercase tracking-wide text-blue-800">Help desk controls</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label>Status</Label>
                    <NativeSelect value={statusDraft} onChange={(e) => setStatusDraft(e.target.value)}>
                      {statuses.map((s) => (
                        <option key={s} value={s}>
                          {statusLabel(s)}
                        </option>
                      ))}
                    </NativeSelect>
                  </div>
                  <div className="space-y-1">
                    <Label>Resolution note</Label>
                    <Input value={resolutionDraft} onChange={(e) => setResolutionDraft(e.target.value)} placeholder="Fixed and verified" />
                  </div>
                </div>
                <Button
                  size="sm"
                  className="w-full"
                  disabled={busy}
                  onClick={() => void updateTicket({ status: statusDraft, resolution: resolutionDraft || undefined })}
                >
                  <RefreshCcw className="h-4 w-4" /> Update ticket
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void clearChat()}>
                    <Eraser className="h-4 w-4" /> Remove / Clear Chat
                  </Button>
                  <Button size="sm" variant="destructive" disabled={busy} onClick={() => void removeTicket()}>
                    <Trash2 className="h-4 w-4" /> Delete ticket
                  </Button>
                </div>
              </div>
            ) : null}

            {/* private 1-on-1 thread */}
            <div>
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                <MessageSquare className="h-3.5 w-3.5" /> Private conversation (agent &amp; officials only)
              </p>
              <div className="max-h-[40vh] space-y-2 overflow-y-auto rounded-xl bg-slate-50 p-2.5 thin-scroll">
                {thread.messages.map((m) => {
                  const mine = m.fromUserId === viewer?.id;
                  return (
                    <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                      <div
                        className={cn(
                          "max-w-[82%] rounded-2xl px-3 py-2 text-xs shadow-sm",
                          mine ? "bg-blue-600 text-white" : "bg-white text-slate-800",
                        )}
                      >
                        <p className={cn("text-[9px] font-semibold uppercase", mine ? "text-blue-100" : "text-slate-400")}>
                          {m.senderName} · {m.senderRole}
                        </p>
                        <p className="mt-0.5 whitespace-pre-wrap">{m.body}</p>
                        {m.attachmentUrl ? (
                          <a
                            href={m.attachmentUrl}
                            target="_blank"
                            rel="noreferrer"
                            className={cn("mt-1 block underline", mine ? "text-blue-100" : "text-blue-600")}
                          >
                            attachment
                          </a>
                        ) : null}
                        <p className={cn("mt-1 text-[9px]", mine ? "text-blue-100" : "text-muted-foreground")}>{timeAgo(m.createdAt)}</p>
                      </div>
                    </div>
                  );
                })}
                <div ref={endRef} />
              </div>
            </div>

            <div className="space-y-1">
              <Button variant="outline" size="sm" className="w-full" onClick={() => void clearChat()} disabled={busy}>
                <Eraser className="h-4 w-4" /> Remove / Clear Chat
              </Button>
              <Button variant="outline" size="sm" className="w-full" onClick={() => fileRef.current?.click()}>
                <Paperclip className="h-4 w-4" /> {proofUrl ? "Attachment ready" : "Attach to next reply"}
              </Button>
              {proofUrl ? <p className="truncate text-[10px] text-emerald-700">{proofUrl}</p> : null}
            </div>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
