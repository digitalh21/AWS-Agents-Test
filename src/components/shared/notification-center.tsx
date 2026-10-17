"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Bell,
  BellRing,
  CheckCheck,
  ClipboardList,
  Loader2,
  Megaphone,
  Settings2,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { cn, dateTime, timeAgo } from "@/lib/utils";

type Notice = {
  id: number;
  title: string;
  body: string;
  audienceRole: string;
  createdAt: string;
  readAt: string | null;
};

type Broadcast = {
  id: number;
  title: string;
  body: string;
  imageUrl: string | null;
  kind: string;
  requireAcknowledgment: boolean;
  createdAt: string;
  createdByName: string | null;
  acknowledgedAt: string | null;
};

type TaskItem = {
  label: string;
  count: number;
  href: string;
  tone: "warn" | "danger" | "info" | "success";
};

const KIND_META: Record<string, { label: string; icon: typeof Bell; className: string }> = {
  broadcast: { label: "Broadcast", icon: Megaphone, className: "bg-blue-50 text-blue-700 border-blue-200" },
  alert: { label: "Alert", icon: ShieldAlert, className: "bg-rose-50 text-rose-700 border-rose-200" },
  system: { label: "System", icon: Settings2, className: "bg-slate-100 text-slate-600 border-slate-200" },
  task: { label: "Task", icon: ClipboardList, className: "bg-amber-50 text-amber-700 border-amber-200" },
};

/**
 * Notification Center.
 * Opens as a full popup modal from the bell icon — alerts, broadcasts, system
 * updates and task reminders in one place. Replaces the old passive banner sheet.
 */
export function NotificationCenter({ isStaff, onChanged }: { isStaff: boolean; onChanged?: () => void }) {
  const [open, setOpen] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [tab, setTab] = useState<"all" | "broadcasts" | "tasks">("all");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [n, b] = await Promise.all([
      fetch("/api/notifications").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/broadcasts").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    setNotices((n?.rows as Notice[]) ?? []);
    setBroadcasts(((b?.rows as Broadcast[]) ?? []).slice(0, 10));

    // task reminders come from the live queues
    const t: TaskItem[] = [];
    if (isStaff) {
      const [a, e, k] = await Promise.all([
        fetch("/api/approvals?scope=PENDING").then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/lead-errors?scope=PENDING").then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/tickets?scope=OPEN").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      const deals = Number(a?.counts?.deals ?? 0);
      const payouts = Number(a?.counts?.withdrawals ?? 0);
      if (deals + payouts) t.push({ label: `${deals} deal + ${payouts} payout approval(s) waiting`, count: deals + payouts, href: "/dashboard/approvals", tone: "warn" });
      if (Number(e?.counts?.pending ?? 0)) t.push({ label: `${e?.counts?.pending} lead error report(s) to review`, count: Number(e?.counts?.pending), href: "/lead-errors", tone: "danger" });
      if (Number(k?.counts?.open ?? 0)) t.push({ label: `${k?.counts?.open} open help desk ticket(s)`, count: Number(k?.counts?.open), href: "/dashboard/tickets", tone: "info" });
    } else {
      const k = await fetch("/api/tickets").then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const waiting = Number(k?.counts?.waiting ?? 0);
      const mine = Number(k?.counts?.open ?? 0);
      if (waiting) t.push({ label: `${waiting} ticket(s) awaiting your reply`, count: waiting, href: "/dashboard/tickets", tone: "info" });
      if (mine) t.push({ label: `${mine} open ticket(s) on your account`, count: mine, href: "/dashboard/tickets", tone: "warn" });
    }
    setTasks(t);
    setLoading(false);
  }, [isStaff]);

  useEffect(() => {
    void load();
  }, [load]);

  const unread = notices.filter((n) => !n.readAt).length;
  const pendingBroadcasts = broadcasts.filter((b) => b.requireAcknowledgment && !b.acknowledgedAt).length;

  async function markAllRead() {
    setBusy(true);
    const res = await fetch("/api/notifications", { method: "PATCH" });
    if (res.ok) {
      toast.success("All alerts marked read");
      await load();
      onChanged?.();
    } else toast.error("Could not update");
    setBusy(false);
  }

  async function ack(b: Broadcast) {
    setBusy(true);
    const res = await fetch("/api/broadcasts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: b.id, response: "ACKNOWLEDGED" }),
    });
    if (res.ok) {
      toast.success("Acknowledged");
      await load();
      onChanged?.();
    } else toast.error("Could not acknowledge");
    setBusy(false);
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="relative shrink-0"
        onClick={() => setOpen(true)}
        aria-label="Notification center"
      >
        {unread || pendingBroadcasts ? <BellRing className="h-5 w-5 text-blue-600" /> : <Bell className="h-5 w-5" />}
        {unread + pendingBroadcasts > 0 ? (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
            {unread + pendingBroadcasts > 9 ? "9+" : unread + pendingBroadcasts}
          </span>
        ) : null}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          {/* header */}
          <div className="sticky top-0 z-10 border-b bg-white/95 p-4 backdrop-blur">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white">
                <Bell className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">Notification Center</p>
                <p className="text-[11px] text-muted-foreground">
                  {unread} unread alert{unread === 1 ? "" : "s"}
                  {pendingBroadcasts ? ` · ${pendingBroadcasts} broadcast(s) need your response` : ""}
                </p>
              </div>
              <Button size="xs" variant="outline" disabled={busy || unread === 0} onClick={() => void markAllRead()}>
                <CheckCheck className="h-3 w-3" /> Mark all read
              </Button>
            </div>

            <div className="mt-2 flex gap-1.5">
              {([
                ["all", `Alerts (${notices.length})`],
                ["broadcasts", `Broadcasts (${broadcasts.length})`],
                ["tasks", `Tasks (${tasks.length})`],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-[11px] font-semibold transition",
                    tab === key ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2 p-4">
            {loading ? (
              <p className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </p>
            ) : null}

            {/* ---------- tasks ---------- */}
            {(tab === "all" || tab === "tasks") && tasks.length ? (
              <div className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  <ClipboardList className="h-3 w-3" /> Task reminders
                </p>
                {tasks.map((t) => (
                  <a
                    key={t.href + t.label}
                    href={t.href}
                    className="flex items-center gap-2 rounded-xl border p-2.5 transition hover:bg-slate-50"
                  >
                    <span
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold",
                        t.tone === "danger" && "bg-rose-50 text-rose-700",
                        t.tone === "warn" && "bg-amber-50 text-amber-700",
                        t.tone === "info" && "bg-blue-50 text-blue-700",
                        t.tone === "success" && "bg-emerald-50 text-emerald-700",
                      )}
                    >
                      {t.count}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{t.label}</span>
                    <span className="shrink-0 text-[11px] text-blue-600">Open →</span>
                  </a>
                ))}
              </div>
            ) : null}

            {/* ---------- broadcasts ---------- */}
            {(tab === "all" || tab === "broadcasts") && broadcasts.length ? (
              <div className="space-y-1.5">
                <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  <Megaphone className="h-3 w-3" /> Broadcast messages
                </p>
                {broadcasts.map((b) => (
                  <div
                    key={b.id}
                    className={cn(
                      "rounded-xl border p-2.5",
                      b.requireAcknowledgment && !b.acknowledgedAt ? "border-amber-300 bg-amber-50/60" : "bg-white",
                    )}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="min-w-0 flex-1 truncate text-xs font-bold">{b.title}</p>
                      <Badge variant={b.kind === "POPUP" ? "danger" : "default"}>{b.kind}</Badge>
                    </div>
                    <p className="mt-0.5 line-clamp-3 text-[11px] text-muted-foreground">{b.body}</p>
                    {b.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={b.imageUrl} alt="" className="mt-1.5 h-20 w-full rounded-lg border object-cover" />
                    ) : null}
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[10px] text-muted-foreground">
                        {b.createdByName ?? "Management"} · {timeAgo(b.createdAt)}
                      </span>
                      {b.requireAcknowledgment ? (
                        b.acknowledgedAt ? (
                          <Badge variant="success">
                            <CheckCheck className="h-2.5 w-2.5" /> acknowledged
                          </Badge>
                        ) : (
                          <Button size="xs" variant="secondary" disabled={busy} onClick={() => void ack(b)}>
                            Acknowledge
                          </Button>
                        )
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {/* ---------- alerts ---------- */}
            {(tab === "all" || tab === "tasks") && !loading && notices.length === 0 && tasks.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center">
                <Bell className="h-6 w-6 text-slate-300" />
                <p className="text-sm font-medium">You are all caught up</p>
                <p className="max-w-xs text-xs text-muted-foreground">
                  Alerts, broadcasts and task reminders will appear here.
                </p>
              </div>
            ) : null}

            {notices.map((n) => {
              const meta = /error|alert|reject/i.test(n.title)
                ? KIND_META.alert
                : /broadcast|announce|popup/i.test(n.title)
                  ? KIND_META.broadcast
                  : /system|cron|cleanup|schema/i.test(n.title)
                    ? KIND_META.system
                    : KIND_META.task;
              const Icon = meta.icon;
              return (
                <div
                  key={n.id}
                  className={cn("rounded-xl border p-2.5", n.readAt ? "bg-white" : "border-blue-200 bg-blue-50/40")}
                >
                  <div className="flex items-start gap-2">
                    <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border", meta.className)}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <p className="min-w-0 flex-1 truncate text-xs font-bold">{n.title}</p>
                        {!n.readAt ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" /> : null}
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{n.body}</p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {timeAgo(n.createdAt)} · {dateTime(n.createdAt)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}

            {(tab === "broadcasts" && broadcasts.length === 0) ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center">
                <Megaphone className="h-6 w-6 text-slate-300" />
                <p className="text-sm font-medium">No broadcasts</p>
              </div>
            ) : null}

            {!loading && tab === "all" && notices.length === 0 && tasks.length === 0 && broadcasts.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center">
                <AlertTriangle className="h-6 w-6 text-slate-300" />
                <p className="text-sm font-medium">Nothing to show yet</p>
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
