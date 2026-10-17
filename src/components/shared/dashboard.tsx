"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BadgeIndianRupee,
  CalendarClock,
  Clock,
  Loader2,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { ActivityTracker } from "@/components/shared/activity-tracker";
import { LiveActivityCounter } from "@/components/agent/live-activity-counter";
import { useInteraction } from "@/components/shared/security-guard";
import { useApp } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { SectionCard, Stat } from "@/components/ui/field";
import { cn, hms, inr, num, timeAgo } from "@/lib/utils";

type Counters = Record<string, number>;

type Earnings = {
  profile: { walletTotal: string; walletPending: string; walletApproved: string; activeSeconds: number } | null;
  earningsSummary?: { approvedCommission: number; pendingCommission: number; bonusTotal: number; approvedCount: number };
  activityToday?: { activeSeconds: number; touchedLeads: number; statusChanges: number; dealsClosed: number; callsMade: number };
  dailyActivity?: Array<{ day: string; activeSeconds: number; touchedLeads: number; statusChanges: number; dealsClosed: number; callsMade: number }>;
};

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

/** The six stage counters required across every dashboard. */
export function StageCounterCards({ scope, className }: { scope: "staff" | "agent"; className?: string }) {
  const { nicheId } = useApp();
  const [counts, setCounts] = useState<Counters>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams(scope === "agent" ? { mine: "true" } : {});
    if (nicheId) params.set("nicheId", String(nicheId));
    let alive = true;
    setLoading(true);
    void fetch(`/api/pipeline/counts?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { counters?: Counters } | null) => {
        if (alive) setCounts(j?.counters ?? {});
      })
      .catch(() => undefined)
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [scope, nicheId]);

  const stages = [
    { key: "IN_PROGRESS", label: "In Process", tone: "text-blue-600", dot: "bg-blue-500" },
    { key: "CALLBACK", label: "Call back", tone: "text-amber-600", dot: "bg-amber-500" },
    { key: "NO_RESPONSE", label: "No Response", tone: "text-orange-600", dot: "bg-orange-500" },
    { key: "PAYMENT_APPROVAL", label: "Payment Approval", tone: "text-violet-600", dot: "bg-violet-500" },
    { key: "REJECTED", label: "Reject / Not Interest", tone: "text-rose-600", dot: "bg-rose-500" },
  ];

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <div className="min-w-0 rounded-xl border bg-white p-2.5 shadow-sm">
          <p className="truncate text-[9px] font-semibold uppercase tracking-wider text-muted-foreground sm:text-[10px]">All Leads</p>
          <p className="mt-0.5 text-lg font-bold tabular-nums sm:text-xl">{num(counts.ALL ?? 0)}</p>
        </div>
        {stages.map((s) => (
          <div key={s.key} className="min-w-0 rounded-xl border bg-white p-2.5 shadow-sm">
            <p className="flex items-center gap-1 truncate text-[9px] font-semibold uppercase tracking-wider text-muted-foreground sm:text-[10px]">
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", s.dot)} />
              <span className="truncate">{s.label}</span>
            </p>
            <p className={cn("mt-0.5 text-lg font-bold tabular-nums sm:text-xl", s.tone)}>{num(counts[s.key] ?? 0)}</p>
          </div>
        ))}
      </div>
      {loading ? (
        <p className="flex items-center gap-1.5 px-1 text-[10px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> refreshing counters…
        </p>
      ) : (
        <p className="px-1 text-[10px] text-muted-foreground">
          {scope === "agent" ? "Your queue" : "Whole book"}
          {nicheId ? " · niche filtered" : " · all niches"}
        </p>
      )}
    </div>
  );
}

export function Dashboard() {
  const interaction = useInteraction();
  const { user, niches } = useApp();
  const isAgent = user.role === "AGENT";
  const [earnings, setEarnings] = useState<Earnings | null>(null);
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    if (isAgent) {
      const res = await fetch("/api/agent/profile?include=earnings");
      if (res.ok) setEarnings(await res.json());
    } else {
      // staff still get their own earnings/attendance context
      const res = await fetch("/api/agent/profile?include=earnings");
      if (res.ok) setEarnings(await res.json());
    }
    setLoading(false);
  }, [isAgent]);

  useEffect(() => {
    void load();
  }, [load]);

  const s = earnings?.earningsSummary;
  const today = earnings?.activityToday;

  const topNiche = useMemo(() => [...niches].sort((a, b) => (b.total ?? 0) - (a.total ?? 0))[0], [niches]);

  return (
    <div className="space-y-3 pb-4">

      <div className="space-y-3 p-3 sm:p-4 lg:p-6">
        {/* ---------- personalized greeting ---------- */}
        <div className="rounded-2xl border bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-700 p-4 text-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-2xl font-bold leading-tight sm:text-3xl">
                {greeting()}, {user.name.split(" ")[0]}!
              </p>
              <p className="mt-1 text-xs text-blue-100 sm:text-sm">
                {isAgent
                  ? "Here is your queue for today — clear the Call back bucket first."
                  : "Here is the live position across the whole book."}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold capitalize">{user.role}</span>
                {today ? (
                  <span className="flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold">
                    ⏱ {hms(today.activeSeconds)} active today
                    <span className="hidden sm:inline">· {today.dealsClosed} closed</span>
                  </span>
                ) : null}
                {today ? (
                  <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold">
                    📞 {num(today.callsMade)} calls · {num(today.dealsClosed)} closed
                  </span>
                ) : null}
              </div>
            </div>
            <div className="text-right">
              <p className="text-xl font-bold tabular-nums sm:text-2xl">
                {clock.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              </p>
              <p className="text-[10px] text-blue-100">
                {clock.toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" })}
              </p>
            </div>
          </div>
        </div>

        {/* ---------- live stage counters ---------- */}
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 px-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            <Target className="h-3.5 w-3.5" /> Live pipeline counters
          </p>
          <StageCounterCards scope={isAgent ? "agent" : "staff"} />
        </div>

        {/* ---------- earnings summary ---------- */}
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 px-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            <Wallet className="h-3.5 w-3.5" /> Earnings summary
          </p>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat
              label="Total amount earned"
              value={inr(earnings?.profile?.walletTotal ?? 0)}
              hint={s ? `${num(s.approvedCount)} approved deal(s)` : "lifetime credit"}
              tone="success"
            />
            <Stat label="Pending payout" value={inr(earnings?.profile?.walletPending ?? 0)} hint="awaiting transfer" tone="warn" />
            <Stat label="Approved payout" value={inr(s?.approvedCommission ?? 0)} hint="cleared commission" tone="info" />
            <Stat label="Withdrawn" value={inr(earnings?.profile?.walletApproved ?? 0)} hint="paid to bank / UPI" />
          </div>
        </div>

        {/* ---------- active time tracker ---------- */}
        <ActivityTracker />
        <LiveActivityCounter state={interaction.state} />

        {/* ---------- quick actions ---------- */}
        <SectionCard title="Quick actions" icon={<TrendingUp className="h-3.5 w-3.5" />}>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {isAgent ? (
              <>
                <Link href="/agent">
                  <Button variant="secondary" className="w-full">
                    My Leads <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <Link href="/agent/earnings">
                  <Button variant="outline" className="w-full">
                    <BadgeIndianRupee className="h-4 w-4" /> Earnings
                  </Button>
                </Link>
                <Link href="/agent/profile">
                  <Button variant="outline" className="w-full">
                    Profile &amp; KYC
                  </Button>
                </Link>
                <Link href="/tickets">
                  <Button variant="outline" className="w-full">
                    Help Desk
                  </Button>
                </Link>
              </>
            ) : (
              <>
                <Link href="/pipeline">
                  <Button variant="secondary" className="w-full">
                    Kanban Pipeline <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <Link href="/approvals">
                  <Button variant="outline" className="w-full">
                    Approvals Center
                  </Button>
                </Link>
                <Link href="/broadcasts">
                  <Button variant="outline" className="w-full">
                    <MegaphoneIcon /> Banners &amp; Popups
                  </Button>
                </Link>
                <Link href="/tickets">
                  <Button variant="outline" className="w-full">
                    Help Desk
                  </Button>
                </Link>
              </>
            )}
          </div>
          {topNiche ? (
            <p className="mt-2 text-[11px] text-muted-foreground">
              Largest niche: <strong>{topNiche.name}</strong> with {num(topNiche.total ?? 0)} leads.
            </p>
          ) : null}
        </SectionCard>

        {/* ---------- recent daily activity (agents) ---------- */}
        {isAgent && (earnings?.dailyActivity ?? []).length ? (
          <SectionCard title="Your last 7 days" icon={<CalendarClock className="h-3.5 w-3.5" />}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
              {(earnings?.dailyActivity ?? []).slice(0, 7).map((d) => (
                <div key={d.day} className="rounded-lg bg-slate-50 p-2 text-center">
                  <p className="truncate text-[9px] uppercase text-muted-foreground">{d.day.slice(5)}</p>
                  <p className="text-xs font-bold tabular-nums text-emerald-700">{hms(d.activeSeconds)}</p>
                  <p className="text-[10px] text-muted-foreground">{num(d.dealsClosed)} closed</p>
                </div>
              ))}
            </div>
          </SectionCard>
        ) : null}

        {loading ? (
          <p className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading dashboard…
          </p>
        ) : null}

        <p className="flex items-center justify-center gap-1 pb-2 text-[10px] text-muted-foreground">
          <Clock className="h-3 w-3" /> Counters refresh automatically · {timeAgo(new Date())}
        </p>
      </div>
    </div>
  );
}

function MegaphoneIcon() {
  return <span aria-hidden>📢</span>;
}
