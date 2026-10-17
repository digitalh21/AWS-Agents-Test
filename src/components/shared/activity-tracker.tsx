"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Eye, EyeOff, Loader2, Timer } from "lucide-react";
import { SectionCard, Stat } from "@/components/ui/field";
import { cn, hms, num } from "@/lib/utils";

type Snapshot = {
  activeSeconds: number;
  touchedLeads: number;
  statusChanges: number;
  dealsClosed: number;
  callsMade: number;
};

/**
 * Active Time Tracker.
 *
 * Counts only while the tab is actually visible (Page Visibility API), syncs to
 * /api/agent/track-time every 60 seconds, and flushes the remainder on unload.
 */
export function ActivityTracker({ compact = false }: { compact?: boolean }) {
  const [today, setToday] = useState<Snapshot | null>(null);
  const [lifetime, setLifetime] = useState(0);
  const [session, setSession] = useState(0);
  const [visible, setVisible] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const startedRef = useRef(false);

  /* ---------- load today's snapshot ---------- */
  const load = useCallback(async () => {
    const res = await fetch("/api/agent/track-time");
    if (!res.ok) return;
    const json = (await res.json()) as { today: Snapshot; totals?: { activeSeconds: number } };
    setToday(json.today ?? null);
    setLifetime(json.totals?.activeSeconds ?? 0);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* ---------- visibility state ---------- */
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onChange);
    setVisible(document.visibilityState === "visible");
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  /* ---------- live session ticker (visibility-gated) ---------- */
  useEffect(() => {
    // seed session from today's server-side count on first paint
    if (!startedRef.current && today) {
      setSession(today.activeSeconds);
      startedRef.current = true;
    }
    const tick = setInterval(() => {
      if (document.visibilityState === "visible") setSession((s) => s + 1);
    }, 1000);
    return () => clearInterval(tick);
  }, [today]);

  /* ---------- 60s heartbeat sync ---------- */
  useEffect(() => {
    let buffer = 0;
    const count = setInterval(() => {
      if (document.visibilityState === "visible") buffer += 1;
    }, 1000);

    const sync = async () => {
      const payload = buffer;
      if (payload <= 0) return;
      buffer = 0;
      setSyncing(true);
      try {
        const res = await fetch("/api/agent/track-time", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ seconds: payload, day: new Date().toISOString().slice(0, 10) }),
        });
        if (res.ok) {
          const json = (await res.json()) as { today?: Snapshot };
          if (json.today) setToday(json.today);
          setLifetime((l) => l + payload);
          setLastSync(
            // full precision incl. milliseconds — e.g. 14:32:10.452
            new Date().toLocaleTimeString("en-GB", { hour12: false, fractionalSecondDigits: 3 } as Intl.DateTimeFormatOptions),
          );
        }
      } catch {
        /* offline — next tick retries */
      } finally {
        setSyncing(false);
      }
    };

    // auto-save tracking progress to the database every 5 seconds
    const timer = setInterval(sync, 5000);
    const onHide = () => {
      if (document.visibilityState === "hidden" && buffer > 0) void sync();
    };
    document.addEventListener("visibilitychange", onHide);

    return () => {
      clearInterval(count);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onHide);
      if (buffer > 0) {
        void fetch("/api/agent/track-time", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          body: JSON.stringify({ seconds: buffer, day: new Date().toISOString().slice(0, 10) }),
        });
      }
    };
  }, []);

  const tracked = today?.activeSeconds ?? 0;

  if (compact) {
    return (
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
          visible ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700",
        )}
        title={visible ? "Tracking active time (tab visible)" : "Paused — switch back to this tab"}
      >
        {visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
        <span className="tabular-nums">{hms(session)}</span>
        {!visible ? <span className="hidden sm:inline">paused</span> : null}
      </div>
    );
  }

  return (
    <SectionCard
      title="Active Time Tracker"
      icon={<Timer className="h-3.5 w-3.5" />}
      action={
        <span
          className={cn(
            "flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-bold",
            visible ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700",
          )}
        >
          {visible ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 live-dot" /> TRACKING
            </>
          ) : (
            <>
              <EyeOff className="h-3 w-3" /> PAUSED
            </>
          )}
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Stat label="Today (server-synced)" value={hms(tracked)} hint="tab-visible seconds only" tone="success" />
        <Stat
          label="This session"
          value={hms(session)}
          hint={visible ? "counting now" : "paused while hidden"}
          tone={visible ? "info" : "warn"}
        />
        <Stat label="Lifetime tracked" value={hms(lifetime)} hint="all recorded activity" />
        <Stat label="Last sync" value={syncing ? "syncing…" : lastSync ?? "—"} hint="auto-saved every 5 seconds" />
      </div>

      {today ? (
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg bg-slate-50 p-2 text-center">
            <p className="text-[9px] uppercase text-muted-foreground">Leads touched</p>
            <p className="text-sm font-bold tabular-nums">{num(today.touchedLeads)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-2 text-center">
            <p className="text-[9px] uppercase text-muted-foreground">Status changes</p>
            <p className="text-sm font-bold tabular-nums">{num(today.statusChanges)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-2 text-center">
            <p className="text-[9px] uppercase text-muted-foreground">Deals closed</p>
            <p className="text-sm font-bold tabular-nums">{num(today.dealsClosed)}</p>
          </div>
          <div className="rounded-lg bg-slate-50 p-2 text-center">
            <p className="text-[9px] uppercase text-muted-foreground">Calls made</p>
            <p className="text-sm font-bold tabular-nums">{num(today.callsMade)}</p>
          </div>
        </div>
      ) : (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> loading today's counters…
        </p>
      )}

      <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-slate-50 p-2 text-[10px] text-muted-foreground">
        <Activity className="h-3 w-3 shrink-0" />
        Uses the Page Visibility API — time counts only while this tab is the active one. Switching tabs or minimising pauses the clock, so
        idle/background time is never billed.
      </p>
    </SectionCard>
  );
}
