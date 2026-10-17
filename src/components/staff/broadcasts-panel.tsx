"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  Eye,
  FileText,
  ImagePlus,
  Loader2,
  Megaphone,
  MessageSquareText,
  Pencil,
  Plus,
  Power,
  RefreshCcw,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, Input, Label, NativeSelect, SectionCard, Stat, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/dialog";
import { useApp } from "@/components/app-shell";
import { cn, dateTime, num, timeAgo } from "@/lib/utils";

type Broadcast = {
  id: number;
  title: string;
  body: string;
  imageUrl: string | null;
  videoUrl: string | null;
  audioUrl: string | null;
  kind: string;
  broadcastType: "strict_lock" | "management_lock" | "dismissible_popup" | "site_banner" | string;
  audienceRole: string;
  targetUserId: string | null;
  requireAcknowledgment: boolean;
  isActive: boolean;
  createdAt: string;
  expiresAt: string | null;
  createdByName: string | null;
  audienceCount: number;
  ackCount: number;
};

type Ack = {
  broadcastId: number;
  userId: string;
  userName: string;
  userRole: string;
  response: string;
  acknowledgedAt: string;
};

type Agent = { id: string; name: string; role: string };

type Template = {
  id: number;
  title: string;
  body: string;
  imageUrl: string | null;
  videoUrl: string | null;
  audioUrl: string | null;
  kind: string;
  createdAt: string;
};

type Comment = {
  id: number;
  broadcastId: number;
  userId: string;
  userName: string | null;
  body: string;
  createdAt: string;
};

/** Which display formats a broadcast/template carries. */
function formatsOf(m: { imageUrl: string | null; videoUrl: string | null; audioUrl: string | null }): string[] {
  const out = ["TEXT"];
  if (m.imageUrl) out.push("IMAGE");
  if (m.videoUrl) out.push("VIDEO");
  if (m.audioUrl) out.push("AUDIO");
  return out;
}

function FormatChips({ item }: { item: { imageUrl: string | null; videoUrl: string | null; audioUrl: string | null } }) {
  return (
    <span className="inline-flex gap-1">
      {formatsOf(item).map((f) => (
        <span key={f} className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-slate-500">
          {f}
        </span>
      ))}
    </span>
  );
}

export function BroadcastsPanel() {
  const { user } = useApp();
  const [tab, setTab] = useState<"broadcasts" | "templates">("broadcasts");
  const [rows, setRows] = useState<Broadcast[]>([]);
  const [acks, setAcks] = useState<Ack[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Broadcast | null>(null);
  const [commentsFor, setCommentsFor] = useState<Broadcast | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [tplOpen, setTplOpen] = useState(false);
  const [tplEditId, setTplEditId] = useState<number | null>(null);

  const emptyForm = {
    title: "",
    body: "",
    broadcastType: "dismissible_popup",
    audienceRole: "AGENT",
    targetUserId: "",
    requireAcknowledgment: true,
    expiresInHours: "",
    videoUrl: "",
    audioUrl: "",
  };
  const [form, setForm] = useState(emptyForm);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const emptyTpl = { title: "", body: "", kind: "POPUP", imageUrl: "", videoUrl: "", audioUrl: "" };
  const [tplForm, setTplForm] = useState(emptyTpl);

  const load = useCallback(async () => {
    setLoading(true);
    const [b, a, t] = await Promise.all([
      fetch("/api/broadcasts?mode=manage").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/agents").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/broadcasts/templates").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (b) {
      setRows(b.rows ?? []);
      setAcks(b.acknowledgments ?? []);
    }
    if (a) setAgents((a.rows ?? []).filter((x: Agent & { role: string }) => x.role === "AGENT"));
    if (t) setTemplates(t.rows ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadComments(b: Broadcast) {
    setCommentsFor(b);
    setCommentsLoading(true);
    const res = await fetch(`/api/broadcasts/comments?broadcastId=${b.id}`);
    if (res.ok) {
      const json = (await res.json()) as { rows: Comment[] };
      setComments(json.rows ?? []);
    }
    setCommentsLoading(false);
  }

  async function upload(file: File) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", "BROADCAST");
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const json = (await res.json()) as { url?: string; error?: string };
    if (res.ok && json.url) {
      setImageUrl(json.url);
      toast.success("Image attached");
    } else toast.error(json.error ?? "Upload failed");
  }

  function openCreate(prefill?: Partial<typeof emptyForm>) {
    setEditId(null);
    setForm({ ...emptyForm, ...prefill });
    setImageUrl(prefill && "imageUrl" in prefill ? ((prefill as { imageUrl?: string | null }).imageUrl ?? null) : null);
    setOpen(true);
  }

  function openEdit(b: Broadcast) {
    setEditId(b.id);
    setForm({
      ...emptyForm,
      title: b.title,
      body: b.body,
      broadcastType: b.broadcastType ?? "dismissible_popup",
      audienceRole: b.audienceRole,
      targetUserId: b.targetUserId ?? "",
      requireAcknowledgment: b.requireAcknowledgment,
      expiresInHours: "",
      videoUrl: b.videoUrl ?? "",
      audioUrl: b.audioUrl ?? "",
    });
    setImageUrl(b.imageUrl);
    setOpen(true);
  }

  async function save() {
    setBusy(true);
    const payload: Record<string, unknown> = {
      title: form.title,
      body: form.body,
      broadcastType: form.broadcastType,
      requireAcknowledgment: form.broadcastType === "strict_lock" || form.broadcastType === "management_lock",
      imageUrl,
      videoUrl: form.videoUrl || undefined,
      audioUrl: form.audioUrl || undefined,
    };
    const res = editId
      ? await fetch("/api/broadcasts", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: editId, ...payload }),
        })
      : await fetch("/api/broadcasts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...payload,
            audienceRole: form.audienceRole,
            targetUserId: form.targetUserId || undefined,
            expiresInHours: form.expiresInHours ? Number(form.expiresInHours) : undefined,
          }),
        });
    const json = (await res.json()) as { error?: string };
    if (res.ok) {
      toast.success(editId ? "Broadcast updated" : "Broadcast sent");
      setOpen(false);
      setForm(emptyForm);
      setImageUrl(null);
      setEditId(null);
      await load();
    } else toast.error(json.error ?? "Could not save");
    setBusy(false);
  }

  async function toggle(id: number, isActive: boolean) {
    const res = await fetch("/api/broadcasts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, isActive }),
    });
    if (res.ok) {
      toast.success(isActive ? "Broadcast activated" : "Broadcast disabled — no longer shown to agents");
      await load();
    } else toast.error("Update failed");
  }

  async function remove(id: number) {
    const res = await fetch(`/api/broadcasts?id=${id}`, { method: "DELETE" });
    const json = (await res.json()) as { error?: string };
    if (res.ok) {
      toast.success("Broadcast deleted");
      await load();
    } else toast.error(json.error ?? "Delete failed");
  }

  /* ---------------- templates ---------------- */

  function openTplCreate() {
    setTplEditId(null);
    setTplForm(emptyTpl);
    setTplOpen(true);
  }

  function openTplEdit(t: Template) {
    setTplEditId(t.id);
    setTplForm({
      title: t.title,
      body: t.body,
      kind: t.kind,
      imageUrl: t.imageUrl ?? "",
      videoUrl: t.videoUrl ?? "",
      audioUrl: t.audioUrl ?? "",
    });
    setTplOpen(true);
  }

  async function saveTemplate() {
    setBusy(true);
    const res = tplEditId
      ? await fetch("/api/broadcasts/templates", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: tplEditId, ...tplForm }),
        })
      : await fetch("/api/broadcasts/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(tplForm),
        });
    const json = (await res.json()) as { error?: string };
    if (res.ok) {
      toast.success(tplEditId ? "Template updated" : "Template saved");
      setTplOpen(false);
      setTplForm(emptyTpl);
      setTplEditId(null);
      await load();
    } else toast.error(json.error ?? "Could not save template");
    setBusy(false);
  }

  async function removeTemplate(id: number) {
    const res = await fetch(`/api/broadcasts/templates?id=${id}`, { method: "DELETE" });
    const json = (await res.json()) as { error?: string };
    if (res.ok) {
      toast.success("Template deleted");
      await load();
    } else toast.error(json.error ?? "Delete failed (Admin only)");
  }

  function useTemplate(t: Template) {
    setTab("broadcasts");
    setImageUrl(t.imageUrl);
    openCreate({
      title: t.title,
      body: t.body,
      broadcastType: t.kind === "BANNER" ? "site_banner" : "dismissible_popup",
      videoUrl: t.videoUrl ?? "",
      audioUrl: t.audioUrl ?? "",
    });
    setImageUrl(t.imageUrl);
    toast.message("Template loaded — review and send when ready");
  }

  const acksFor = (id: number) => acks.filter((a) => a.broadcastId === id);
  const mandatoryCount = rows.filter((r) => r.requireAcknowledgment && r.isActive).length;
  const activeCount = rows.filter((r) => r.isActive).length;

  return (
    <div className="space-y-3 p-3 sm:p-4 lg:p-6">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Total broadcasts" value={num(rows.length)} hint="all time" />
        <Stat label="Active now" value={num(activeCount)} tone="success" hint="stay live until disabled" />
        <Stat label="Mandatory popups live" value={num(mandatoryCount)} tone="warn" hint="lock the agent screen" />
        <Stat label="Templates" value={num(templates.length)} tone="info" hint="pre-made + custom" />
      </div>

      {/* ---------- tabs ---------- */}
      <div className="flex gap-1 rounded-xl border bg-white p-1">
        {(
          [
            { key: "broadcasts", label: "Broadcasts", icon: Megaphone },
            { key: "templates", label: "Templates", icon: FileText },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition",
              tab === t.key ? "bg-blue-700 text-white shadow" : "text-slate-500 hover:bg-slate-50",
            )}
          >
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "broadcasts" ? (
        <SectionCard
          title="Banners & Popups"
          icon={<Megaphone className="h-3.5 w-3.5" />}
          action={
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => void load()}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              </Button>
              <Button size="sm" onClick={() => openCreate()}>
                <Plus className="h-4 w-4" /> New broadcast
              </Button>
            </div>
          }
        >
          {rows.length === 0 && !loading ? (
            <EmptyState title="No broadcasts yet" hint="Send text, image, video or audio alerts to all agents or a single agent." icon="📢" />
          ) : null}

          <div className="space-y-2">
            {rows.map((b) => {
              const acksN = acksFor(b.id).length;
              const pct = b.audienceCount ? Math.round((acksN / b.audienceCount) * 100) : 0;
              return (
                <div key={b.id} className={cn("rounded-xl border bg-white p-3 shadow-sm", !b.isActive && "opacity-60")}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-bold">
                        <span className="truncate">{b.title}</span>
                        <Badge
                          variant={
                            b.broadcastType === "strict_lock"
                              ? "danger"
                              : b.broadcastType === "management_lock"
                                ? "warn"
                                : b.broadcastType === "site_banner"
                                  ? "success"
                                  : "default"
                          }
                        >
                          {b.broadcastType === "site_banner" ? "site banner" : String(b.broadcastType ?? "popup").replaceAll("_", " ")}
                        </Badge>
                        {!b.isActive ? <Badge variant="muted">disabled</Badge> : <Badge variant="success">active</Badge>}
                        {b.requireAcknowledgment ? <Badge variant="warn">ack required</Badge> : null}
                        <FormatChips item={b} />
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">{b.body}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {b.createdByName ?? "Management"} · {timeAgo(b.createdAt)} · to{" "}
                        <strong>
                          {b.audienceRole === "ALL" ? "everyone" : b.audienceRole}
                          {b.targetUserId ? " (targeted agent)" : ""}
                        </strong>
                      </p>
                      {b.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={b.imageUrl} alt="" className="mt-1.5 h-16 w-24 rounded-lg border object-cover" />
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <div className="text-right">
                        <p className="text-[10px] text-muted-foreground">
                          <Eye className="mr-1 inline h-3 w-3" />
                          {acksN}/{b.audienceCount} acknowledged
                        </p>
                        <div className="mt-0.5 h-1.5 w-24 overflow-hidden rounded-full bg-slate-200">
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="mt-0.5 text-[10px] font-bold text-emerald-700">{pct}%</p>
                      </div>
                      <div className="flex gap-1">
                        <Button size="xs" variant="outline" onClick={() => void loadComments(b)}>
                          <MessageSquareText className="h-3 w-3" /> Comments
                        </Button>
                        <Button size="xs" variant="outline" onClick={() => setDetail(b)}>
                          History
                        </Button>
                        <Button size="xs" variant="outline" onClick={() => openEdit(b)}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button size="xs" variant="outline" onClick={() => void toggle(b.id, !b.isActive)}>
                          <Power className="h-3 w-3" />
                        </Button>
                        <Button size="xs" variant="ghost" className="text-rose-600" onClick={() => void remove(b.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </SectionCard>
      ) : (
        <SectionCard
          title="Broadcast Templates"
          icon={<FileText className="h-3.5 w-3.5" />}
          action={
            <Button size="sm" onClick={openTplCreate}>
              <Plus className="h-4 w-4" /> New template
            </Button>
          }
        >
          {templates.length === 0 && !loading ? (
            <EmptyState title="No templates yet" hint="Save reusable announcements and send them with one tap." icon="🗂️" />
          ) : null}
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {templates.map((t) => (
              <div key={t.id} className="flex flex-col rounded-xl border bg-white p-3 shadow-sm">
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-bold">
                  <span className="flex-1 truncate">{tplEditId === t.id ? "(editing) " : ""}{t.title}</span>
                  <Badge variant={t.kind === "POPUP" ? "danger" : "default"}>{t.kind}</Badge>
                  <FormatChips item={t} />
                </p>
                <p className="mt-1 line-clamp-3 flex-1 whitespace-pre-wrap text-[11px] text-muted-foreground">{t.body}</p>
                <p className="mt-1 text-[9px] text-muted-foreground">Updated {timeAgo(t.createdAt)}</p>
                <div className="mt-2 flex gap-1.5">
                  <Button size="xs" className="flex-1" onClick={() => useTemplate(t)}>
                    <Megaphone className="h-3 w-3" /> Use in broadcast
                  </Button>
                  <Button size="xs" variant="outline" onClick={() => openTplEdit(t)}>
                    <Pencil className="h-3 w-3" /> Edit
                  </Button>
                  {user.role === "ADMIN" ? (
                    <Button size="xs" variant="ghost" className="text-rose-600" onClick={() => void removeTemplate(t.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* ---------- create / edit broadcast sheet ---------- */}
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={editId ? "Edit Broadcast" : "New Broadcast"}
        description="Strict lock forces acknowledgement; management lock also opens private comments; dismissible popups include a Close button; site banners persist on every page. All stay active until you disable them."
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button className="flex-1" disabled={busy || form.title.trim().length < 3 || form.body.trim().length < 3} onClick={() => void save()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
              {editId ? "Save changes" : "Send broadcast"}
            </Button>
          </div>
        }
      >
        <div className="space-y-2">
          <div className="space-y-1">
            <Label>Type *</Label>
            <NativeSelect value={form.broadcastType} onChange={(e) => setForm({ ...form, broadcastType: e.target.value })}>
              <option value="strict_lock">Strict Lock — full-screen lock until acknowledged</option>
              <option value="management_lock">Management Lock — lock + private agent comments</option>
              <option value="dismissible_popup">Dismissible Popup — modal with a Close button</option>
              <option value="site_banner">Site Banner — persistent strip on every page (tap opens modal)</option>
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label>Title *</Label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Mandatory training at 4 PM" />
          </div>
          <div className="space-y-1">
            <Label>Message *</Label>
            <Textarea
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              placeholder="All agents must join the compliance session. Acknowledge once you have read this."
            />
          </div>
          {!editId ? (
            <>
              <div className="space-y-1">
                <Label>Audience *</Label>
                <NativeSelect value={form.audienceRole} onChange={(e) => setForm({ ...form, audienceRole: e.target.value, targetUserId: "" })}>
                  <option value="AGENT">All Agents</option>
                  <option value="ALL">Everyone</option>
                  <option value="MANAGER">Managers</option>
                  <option value="HR">HR</option>
                </NativeSelect>
              </div>
              {form.audienceRole !== "ALL" ? (
                <div className="space-y-1">
                  <Label>…or target a single agent</Label>
                  <NativeSelect value={form.targetUserId} onChange={(e) => setForm({ ...form, targetUserId: e.target.value })}>
                    <option value="">Entire {form.audienceRole.toLowerCase()} audience</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              ) : null}
            </>
          ) : null}

          {/* display formats */}
          <div className="rounded-xl border bg-slate-50 p-2.5">
            <p className="flex items-center justify-between text-[11px] font-bold text-slate-600">
              Display formats
              <FormatChips item={{ imageUrl, videoUrl: form.videoUrl || null, audioUrl: form.audioUrl || null }} />
            </p>
            <div className="mt-2 space-y-2">
              <div className="space-y-1">
                <Label>Image (optional)</Label>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void upload(f);
                  }}
                />
                <Button variant="outline" className="w-full" onClick={() => fileRef.current?.click()}>
                  <ImagePlus className="h-4 w-4" /> {imageUrl ? "Attached — replace" : "Attach image"}
                </Button>
                {imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imageUrl} alt="" className="h-24 w-full rounded-lg border object-cover" />
                ) : null}
              </div>
              <div className="space-y-1">
                <Label>Video URL (optional — auto-embeds in the popup)</Label>
                <Input
                  value={form.videoUrl}
                  onChange={(e) => setForm({ ...form, videoUrl: e.target.value })}
                  placeholder="https://youtube.com/watch?v=… or https://…/clip.mp4"
                />
              </div>
              <div className="space-y-1">
                <Label>Audio URL (optional)</Label>
                <Input
                  value={form.audioUrl}
                  onChange={(e) => setForm({ ...form, audioUrl: e.target.value })}
                  placeholder="https://…/announcement.mp3"
                />
              </div>
            </div>
          </div>

          {!editId ? (
            <div className="space-y-1">
              <Label>Expires after (hours, optional)</Label>
              <Input
                inputMode="numeric"
                value={form.expiresInHours}
                onChange={(e) => setForm({ ...form, expiresInHours: e.target.value.replace(/[^0-9]/g, "") })}
                placeholder="24"
              />
            </div>
          ) : null}
          <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[10px] font-medium text-amber-800">
            Agents see active broadcasts in a popup with a Close button. Their comments stay private — visible only to
            them and management.
          </p>
        </div>
      </Sheet>

      {/* ---------- template create / edit ---------- */}
      <Sheet
        open={tplOpen}
        onOpenChange={setTplOpen}
        title={tplEditId ? "Edit Template" : "New Template"}
        description="Pre-made templates are editable too. Saved templates can be sent from the Broadcasts tab with one tap."
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setTplOpen(false)}>
              Cancel
            </Button>
            <Button className="flex-1" disabled={busy || tplForm.title.trim().length < 3 || tplForm.body.trim().length < 3} onClick={() => void saveTemplate()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              {tplEditId ? "Save changes" : "Save template"}
            </Button>
          </div>
        }
      >
        <div className="space-y-2">
          <div className="space-y-1">
            <Label>Type</Label>
            <NativeSelect value={tplForm.kind} onChange={(e) => setTplForm({ ...tplForm, kind: e.target.value })}>
              <option value="POPUP">Popup</option>
              <option value="BANNER">Banner</option>
            </NativeSelect>
          </div>
          <div className="space-y-1">
            <Label>Title *</Label>
            <Input value={tplForm.title} onChange={(e) => setTplForm({ ...tplForm, title: e.target.value })} placeholder="Weekly target kickoff" />
          </div>
          <div className="space-y-1">
            <Label>Message *</Label>
            <Textarea value={tplForm.body} onChange={(e) => setTplForm({ ...tplForm, body: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label>Image URL (optional)</Label>
            <Input value={tplForm.imageUrl} onChange={(e) => setTplForm({ ...tplForm, imageUrl: e.target.value })} placeholder="https://…" />
          </div>
          <div className="space-y-1">
            <Label>Video URL (optional)</Label>
            <Input value={tplForm.videoUrl} onChange={(e) => setTplForm({ ...tplForm, videoUrl: e.target.value })} placeholder="https://…" />
          </div>
          <div className="space-y-1">
            <Label>Audio URL (optional)</Label>
            <Input value={tplForm.audioUrl} onChange={(e) => setTplForm({ ...tplForm, audioUrl: e.target.value })} placeholder="https://…" />
          </div>
        </div>
      </Sheet>

      {/* ---------- private comments (management sees all) ---------- */}
      <Sheet
        open={Boolean(commentsFor)}
        onOpenChange={(v) => !v && setCommentsFor(null)}
        title={commentsFor ? `Comments · ${commentsFor.title}` : "Comments"}
        description="Private agent comments — only the authoring agent and management can see each comment."
      >
        {commentLoadingOrEmpty()}
      </Sheet>

      {/* ---------- acknowledgment history ---------- */}
      <Sheet
        open={Boolean(detail)}
        onOpenChange={(v) => !v && setDetail(null)}
        title={detail ? `Acknowledgments · ${detail.title}` : "History"}
        description="Complete response history with timestamps"
      >
        {detail ? (
          <div className="space-y-2">
            <div className="rounded-xl border p-2.5 text-xs">
              <p className="font-bold">{detail.body}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                Sent {dateTime(detail.createdAt)} · {detail.audienceCount} recipient(s) · {acksFor(detail.id).length} responded
              </p>
            </div>
            {acksFor(detail.id).length === 0 ? (
              <EmptyState title="No acknowledgments yet" hint="Agents appear here as soon as they respond." icon="⏳" />
            ) : null}
            {acksFor(detail.id).map((a) => (
              <div key={`${a.broadcastId}-${a.userId}`} className="flex items-center justify-between gap-2 rounded-lg border p-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold">
                    {a.userName} <span className="text-[10px] text-muted-foreground">({a.userRole})</span>
                  </p>
                  <p className="text-[10px] text-muted-foreground">{dateTime(a.acknowledgedAt)}</p>
                </div>
                <Badge variant="success">
                  <CheckCircle2 className="h-2.5 w-2.5" /> {a.response}
                </Badge>
              </div>
            ))}
            <p className="flex items-center gap-1 pt-1 text-[10px] text-muted-foreground">
              <Users className="h-3 w-3" /> Pending: {Math.max(0, detail.audienceCount - acksFor(detail.id).length)} agent(s)
            </p>
          </div>
        ) : null}
      </Sheet>
    </div>
  );

  function commentLoadingOrEmpty() {
    if (commentsLoading) {
      return (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      );
    }
    if (comments.length === 0) {
      return <EmptyState title="No comments yet" hint="Private comments from agents appear here." icon="💬" />;
    }
    return (
      <div className="space-y-2">
        {comments.map((c) => (
          <div key={c.id} className="rounded-xl border p-2.5">
            <p className="text-xs text-slate-700">{c.body}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              <strong>{c.userName ?? "Agent"}</strong> · {dateTime(c.createdAt)}
            </p>
          </div>
        ))}
        <p className="flex items-center gap-1 pt-1 text-[10px] text-muted-foreground">
          <MessageSquareText className="h-3 w-3" /> Each comment is visible only to its author and management.
        </p>
      </div>
    );
  }
}
