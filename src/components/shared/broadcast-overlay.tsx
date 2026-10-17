"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Lock, Megaphone, MessageSquareText, Send, Volume2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Input } from "@/components/ui/field";
import { isDirectVideoFile, toEmbedUrl } from "@/lib/video";
import { cn, dateTime, timeAgo } from "@/lib/utils";

type BroadcastType = "strict_lock" | "management_lock" | "dismissible_popup" | "site_banner";

type Broadcast = {
  id: number;
  title: string;
  body: string;
  imageUrl: string | null;
  videoUrl: string | null;
  audioUrl: string | null;
  kind: string;
  broadcastType: BroadcastType;
  requireAcknowledgment: boolean;
  createdAt: string;
  createdByName: string | null;
  acknowledgedAt: string | null;
  response: string | null;
};

type Comment = {
  id: number;
  broadcastId: number;
  userId: string;
  userName: string | null;
  body: string;
  createdAt: string;
};

const RESPONSES = ["ACKNOWLEDGED", "UNDERSTOOD", "NOTED"];
const LOCK_TYPES: BroadcastType[] = ["strict_lock", "management_lock"];

/** Text + Image + Video (auto-embedded iframe) + Audio display formats. */
function MediaBlock({
  imageUrl,
  videoUrl,
  audioUrl,
  compact = false,
}: {
  imageUrl?: string | null;
  videoUrl?: string | null;
  audioUrl?: string | null;
  compact?: boolean;
}) {
  return (
    <>
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt=""
          className={compact ? "h-12 w-16 shrink-0 rounded object-cover" : "w-full rounded-xl border object-cover"}
        />
      ) : null}
      {videoUrl ? (
        isDirectVideoFile(videoUrl) ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video controls className={compact ? "aspect-video w-40 rounded-lg border" : "aspect-video w-full rounded-xl border bg-black"}>
            <source src={videoUrl} />
          </video>
        ) : (
          <iframe
            src={toEmbedUrl(videoUrl) ?? videoUrl}
            title="Broadcast video"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className={compact ? "aspect-video w-40 rounded-lg border" : "aspect-video w-full rounded-xl border bg-black"}
          />
        )
      ) : null}
      {audioUrl ? (
        <div className={cn("flex items-center gap-2 rounded-lg border bg-slate-50 p-2", compact ? "w-full max-w-xs" : "")}>
          <Volume2 className="h-4 w-4 shrink-0 text-slate-500" />
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls src={audioUrl} className="h-8 w-full" />
        </div>
      ) : null}
    </>
  );
}

/** Private comments thread (server filters: agents see ONLY their own). */
function Comments({ broadcastId }: { broadcastId: number }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/broadcasts/comments?broadcastId=${broadcastId}`);
    if (!res.ok) return;
    const json = (await res.json()) as { rows: Comment[] };
    setComments(json.rows ?? []);
  }, [broadcastId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function post() {
    const text = draft.trim();
    if (!text) return;
    setBusy(true);
    const res = await fetch("/api/broadcasts/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ broadcastId, body: text }),
    });
    if (res.ok) {
      setDraft("");
      await load();
    } else {
      const json = (await res.json()) as { error?: string };
      toast.error(json.error ?? "Could not post comment");
    }
    setBusy(false);
  }

  return (
    <div className="rounded-xl border bg-slate-50 p-3">
      <p className="flex items-center gap-1.5 text-xs font-bold text-slate-700">
        <MessageSquareText className="h-3.5 w-3.5" /> Private comments
        <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-semibold text-blue-700">
          only you + management
        </span>
      </p>
      <div className="mt-2 max-h-40 space-y-1.5 overflow-y-auto thin-scroll">
        {comments.length === 0 ? (
          <p className="text-[11px] text-slate-400">No comments yet — ask a question or leave a note for management.</p>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="rounded-lg border bg-white p-2">
              <p className="text-[11px] text-slate-700">{c.body}</p>
              <p className="mt-0.5 text-[9px] text-slate-400">
                {c.userName ?? "You"} · {timeAgo(c.createdAt)}
              </p>
            </div>
          ))
        )}
      </div>
      <div className="mt-2 flex gap-1.5">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Write a private comment…"
          className="h-8 text-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter") void post();
          }}
        />
        <Button size="sm" className="h-8 shrink-0 px-2.5" disabled={busy || !draft.trim()} onClick={() => void post()}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

/**
 * Advanced broadcast layer, mounted site-wide in the AppShell so banners
 * persist across every tab/page:
 *   strict_lock       — blocking modal, must acknowledge (no close, no comments)
 *   management_lock   — blocking modal with private comments + acknowledge
 *   dismissible_popup — modal with a Close button (records DISMISSED)
 *   site_banner       — persistent strip; clicking it opens a dismissible modal
 */
export function BroadcastOverlay({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<Broadcast[]>([]);
  const [busy, setBusy] = useState(false);
  const [bannerDetail, setBannerDetail] = useState<Broadcast | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/broadcasts");
    if (!res.ok) return;
    const json = (await res.json()) as { rows: Broadcast[]; lockScreen: boolean; pending: Broadcast[] };
    setRows(json.rows ?? []);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  async function respond(b: Broadcast, response: string) {
    setBusy(true);
    const res = await fetch("/api/broadcasts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: b.id, response }),
    });
    if (res.ok) {
      if (response !== "DISMISSED") toast.success(`Response recorded: ${response.toLowerCase()}`);
      await load();
      onChanged?.();
    } else toast.error("Could not record your response");
    setBusy(false);
  }

  const banners = rows.filter((r) => r.broadcastType === "site_banner");
  const popup =
    rows.find(
      (r) => r.kind === "POPUP" && r.broadcastType !== "site_banner" && !r.acknowledgedAt,
    ) ?? null;
  const popupIsLock = popup ? LOCK_TYPES.includes(popup.broadcastType) : false;

  const popupHeader = (b: Broadcast): { label: string; sub: string; tone: "danger" | "warn" | "default" } =>
    b.broadcastType === "strict_lock"
      ? { label: "Strict announcement", sub: "Acknowledge to continue working — this stays until you respond", tone: "danger" }
      : b.broadcastType === "management_lock"
        ? { label: "Management announcement", sub: "Comment privately or acknowledge to close", tone: "warn" }
        : { label: "Announcement", sub: "Stays active until management disables it", tone: "default" };

  const renderModal = (b: Broadcast, opts: { dismissible: boolean; comments: boolean; onClose?: () => void }) => {
    const head = popupHeader(b);
    return (
      <div
        key={`modal-${b.id}`}
        className={cn(
          "fixed inset-0 z-[80] flex items-end justify-center backdrop-blur-sm sm:items-center",
          popupIsLock && b === popup ? "bg-slate-950/80" : "bg-slate-950/60",
        )}
      >
        <div className="max-h-[92dvh] w-full animate-sheet overflow-y-auto rounded-t-2xl border bg-white shadow-2xl thin-scroll sm:max-w-lg sm:rounded-2xl">
          <div className="flex items-center gap-2 border-b bg-blue-700 px-4 py-3 text-white">
            {b.broadcastType === "strict_lock" ? <Lock className="h-5 w-5 shrink-0" /> : <Megaphone className="h-5 w-5 shrink-0" />}
            <div className="flex-1">
              <p className="text-xs font-bold uppercase tracking-wider text-blue-100">{head.label}</p>
              <p className="text-[10px] text-blue-200">{head.sub}</p>
            </div>
            {head.tone === "danger" ? <Badge variant="danger">strict lock</Badge> : null}
            {head.tone === "warn" ? <Badge variant="default">management lock</Badge> : null}
            {opts.dismissible ? (
              <button
                type="button"
                aria-label="Close announcement"
                disabled={busy}
                onClick={() => (opts.onClose ? opts.onClose() : void respond(b, "DISMISSED"))}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15 text-white transition hover:bg-white/25 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
              </button>
            ) : null}
          </div>

          <div className="space-y-3 p-4">
            <h2 className="text-lg font-bold leading-snug">{b.title}</h2>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{b.body}</p>
            <MediaBlock imageUrl={b.imageUrl} videoUrl={b.videoUrl} audioUrl={b.audioUrl} />
            <p className="text-[10px] text-muted-foreground">
              Sent by {b.createdByName ?? "Management"} · {dateTime(b.createdAt)}
            </p>

            {LOCK_TYPES.includes(b.broadcastType) && b === popup ? (
              <div className="space-y-2 rounded-xl border bg-slate-50 p-3">
                <p className="text-xs font-semibold text-slate-600">Respond to unlock the workspace:</p>
                <div className="flex flex-wrap gap-2">
                  {RESPONSES.map((r) => (
                    <Button key={r} size="sm" disabled={busy} onClick={() => void respond(b, r)}>
                      <CheckCircle2 className="h-4 w-4" /> {r.toLowerCase()}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}

            {opts.comments ? <Comments broadcastId={b.id} /> : null}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      {/* ---------- persistent site banner (all pages) ---------- */}
      {banners.length ? (
        <div className="space-y-1.5 px-3 pt-3 sm:px-4 lg:px-6">
          {banners.slice(0, 3).map((b) => (
            <button
              type="button"
              key={b.id}
              onClick={() => setBannerDetail(b)}
              className="flex w-full items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 p-2.5 text-left transition hover:bg-blue-100/70"
              title="Tap to open details"
            >
              <Megaphone className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-blue-900">{b.title}</p>
                <p className="line-clamp-1 text-[11px] text-blue-800">{b.body}</p>
                <p className="mt-0.5 text-[10px] text-blue-600">
                  {b.createdByName ?? "Management"} · {timeAgo(b.createdAt)} · tap for details
                </p>
              </div>
              {b.videoUrl ? (
                <MediaBlock videoUrl={b.videoUrl} compact />
              ) : b.imageUrl ? (
                <MediaBlock imageUrl={b.imageUrl} compact />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}

      {/* ---------- rotating popup by broadcast type ---------- */}
      {popup
        ? renderModal(popup, {
            dismissible: popup.broadcastType === "dismissible_popup",
            comments: popup.broadcastType === "management_lock" || popup.broadcastType === "dismissible_popup",
          })
        : null}

      {/* ---------- site banner detail modal (dismissible) ---------- */}
      {bannerDetail
        ? renderModal(bannerDetail, {
            dismissible: true,
            comments: true,
            onClose: () => setBannerDetail(null),
          })
        : null}
    </>
  );
}
