"use client";

import { useEffect, useState } from "react";
import { Activity, Gauge, MousePointerClick, ShieldAlert, Timer } from "lucide-react";
import { Badge } from "@/components/ui/field";
import { cn, hms, num } from "@/lib/utils";

export type LiveActivity = {
  clicks: number;
  actions: number;
  navigations: number;
  leadOpens: number;
  used: number;
  limit: number | null;
  remaining: number | null;
  locked: boolean;
  sessionClicks: number;
  lastSync: string;
};

/**
 * Live click/action counter + session timer + Click Quota gauge.
 *
 * The counter ticks locally every second (instant feedback) and reconciles
 * with the server on every 5s flush, so the number is live without hammering
 * the database.
 */
export function LiveActivityCounter({
  state,
  className,
}: {
  state: LiveActivity;
  className?: string;
}) {
  // local ticker so the displayed count moves smoothly between flushes
  const [tick, setTick] = useState(0);
  const [sessionSeconds, setSessionSeconds] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setTick((v) => v + 1);
      setSessionSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const pct =
    state.limit && state.limit > 0 ? Math.min(100, Math.round((state.used / state.limit) * 100)) : null;
  const remaining = state.remaining;

  return (
    <div className={cn("rounded-xl border bg-white p-3 shadow-sm", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          <Activity className="h-3.5 w-3.5" /> Live activity
        </p>
        {state.locked ? (
          <Badge variant="danger">
            <ShieldAlert className="h-2.5 w-2.5" /> Quota reached — locked
          </Badge>
        ) : (
          <Badge variant="success">live</Badge>
        )}
        {state.lastSync ? (
          <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground">
            synced {state.lastSync}
          </span>
        ) : null}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-lg bg-slate-50 p-2 text-center">
          <p className="text-[9px] uppercase text-muted-foreground">Clicks today</p>
          <p className="text-lg font-bold tabular-nums" data-testid="live-clicks">
            {num(state.clicks)}
          </p>
        </div>
        <div className="rounded-lg bg-slate-50 p-2 text-center">
          <p className="text-[9px] uppercase text-muted-foreground">Actions</p>
          <p className="text-lg font-bold tabular-nums">{num(state.actions)}</p>
        </div>
        <div className="rounded-lg bg-slate-50 p-2 text-center">
          <p className="flex items-center justify-center gap-1 text-[9px] uppercase text-muted-foreground">
            <Timer className="h-2.5 w-2.5" /> Session
          </p>
          <p className="text-lg font-bold tabular-nums" data-testid="live-session">
            {hms(sessionSeconds)}
          </p>
        </div>
        <div className="rounded-lg bg-slate-50 p-2 text-center">
          <p className="flex items-center justify-center gap-1 text-[9px] uppercase text-muted-foreground">
            <Gauge className="h-2.5 w-2.5" /> Lead opens
          </p>
          <p className="text-lg font-bold tabular-nums">{num(state.leadOpens)}</p>
        </div>
      </div>

      {/* click quota gauge */}
      <div className="mt-2 rounded-lg border p-2">
        <div className="flex items-center justify-between text-[10px]">
          <span className="flex items-center gap-1 font-bold text-slate-600">
            <MousePointerClick className="h-3 w-3" /> Daily click quota
          </span>
          <span className="tabular-nums text-muted-foreground">
            {state.limit === null ? "unlimited" : `${state.used} / ${state.limit}`}
            {remaining !== null ? ` · ${remaining} left` : ""}
          </span>
        </div>
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-200">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              state.locked ? "bg-rose-500" : pct !== null && pct >= 80 ? "bg-amber-500" : "bg-emerald-500",
            )}
            style={{ width: `${pct ?? 6}%` }}
          />
        </div>
        <p className="mt-1 text-[9px] text-muted-foreground">
          {state.limit === null
            ? "No limit allocated — management can set a daily maximum from Agents & HR."
            : state.locked
              ? "Limit reached. New clicks and lead opens are blocked for the rest of today."
              : "Actions are blocked automatically once the limit is reached."}
        </p>
      </div>
      <span className="hidden" data-testid="live-tick">{tick}</span>
    </div>
  );
}
