"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BadgeCheck,
  Bell,
  BellRing,
  ChevronRight,
  Filter,
  Grid,
  IdCard,
  Kanban,
  LogOut,
  Menu,
  Phone,
  Radio,
  LayoutGrid,
  Megaphone,
  SlidersHorizontal,
  TriangleAlert,
  Ticket as TicketIcon,
  Award,
  Tags,
  ScrollText,
  Clapperboard,
  FolderOpen,
  Undo2,
  Settings,
  Timer,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Input } from "@/components/ui/field";
import { Sheet } from "@/components/ui/dialog";
import { NotificationCenter } from "@/components/shared/notification-center";
import { DecisionNoticeOverlay } from "@/components/shared/decision-notice-overlay";
import { BroadcastOverlay } from "@/components/shared/broadcast-overlay";
import { ThemeSwitcher } from "@/components/shared/theme-switcher";
import { cn, hms, timeAgo } from "@/lib/utils";

/** Product brand used across the navbar, login and mobile headers. */
export const BRAND_NAME = "Auto Growth Systems";
export const BRAND_SHORT = "AGS";

export type AppUser = { id: string; name: string; email: string; role: string; phone: string | null };
export type NicheOption = { id: number; name: string; slug: string; color: string; total?: number; unassigned?: number };

type Ctx = {
  user: AppUser;
  niches: NicheOption[];
  nicheId: number;
  setNicheId: (id: number) => void;
};

const AppContext = createContext<Ctx | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppShell");
  return ctx;
}

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  phone: Phone,
  wallet: Wallet,
  "id-card": IdCard,
  kanban: Kanban,
  "badge-check": BadgeCheck,
  users: Users,
  bell: Bell,
  scroll: ScrollText,
  timer: Timer,
  radio: Radio,
  film: Clapperboard,
  folder: FolderOpen,
};

export function AppShell({
  user,
  niches,
  navItems,
  impersonator = null,
  children,
}: {
  user: AppUser;
  niches: NicheOption[];
  navItems: Array<{ href: string; label: string; icon: string; badge?: "approvals" | "errors" | "tickets" }>;
  /** set when management is previewing as this user ("Switch as User") */
  impersonator?: { name: string } | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawer, setDrawer] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [notifications, setNotifications] = useState<Array<{ id: number; title: string; body: string; createdAt: string }>>([]);
  const [navBadges, setNavBadges] = useState<{ approvals: number; errors: number; tickets: number }>({
    approvals: 0,
    errors: 0,
    tickets: 0,
  });
  const [nicheId, setNicheState] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);

  /* restore niche filter */
  useEffect(() => {
    setNicheState(Number(window.localStorage.getItem("tc_niche") ?? 0));
  }, []);

  const leadsRoute = user.role === "AGENT" ? "/dashboard/agent" : "/dashboard/admin";

  /**
   * Selecting a niche always lands the user on their Leads page with that
   * category applied — leads, columns and counters all follow.
   */
  const setNicheId = useCallback(
    (id: number) => {
      setNicheState(id);
      window.localStorage.setItem("tc_niche", String(id));
      const name = id ? (niches.find((n) => n.id === id)?.name ?? "niche") : "all niches";
      toast.success(`Filtered to ${name}`);
      // Already on a leads view (canonical or /dashboard alias)? just refilter.
      // Otherwise navigate straight to the leads view for this role.
      const isAgent = user.role === "AGENT";
      const onLeads = isAgent
        ? pathname.startsWith("/agent") || pathname.startsWith("/dashboard/agent")
        : pathname.startsWith("/pipeline") || pathname.startsWith("/dashboard/admin");
      if (!onLeads) router.push(leadsRoute);
    },
    [niches, leadsRoute, pathname, router, user.role],
  );

  /* live queue counters for the sidebar badges */
  useEffect(() => {
    if (!navItems.some((i) => i.badge)) return;
    let alive = true;
    async function load() {
      const [approvals, errors, tickets] = await Promise.all([
        fetch("/api/approvals?scope=PENDING").then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/lead-errors?scope=PENDING").then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/tickets?scope=OPEN").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (!alive) return;
      setNavBadges({
        approvals: Number(approvals?.counts?.deals ?? 0) + Number(approvals?.counts?.withdrawals ?? 0),
        errors: Number(errors?.counts?.pending ?? 0),
        tickets: Number(tickets?.counts?.open ?? 0),
      });
    }
    void load();
    const t = setInterval(load, 30000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [navItems]);

  /* notifications polling + browser push */
  useEffect(() => {
    let alive = true;
    async function load() {
      const res = await fetch("/api/notifications");
      if (!res.ok || !alive) return;
      const json = (await res.json()) as {
        rows: Array<{ id: number; title: string; body: string; createdAt: string; readAt: string | null }>;
      };
      setNotifications(json.rows ?? []);
      if ("Notification" in window && Notification.permission === "granted") {
        const latest = json.rows?.[0];
        if (latest && !latest.readAt && Date.now() - new Date(latest.createdAt).getTime() < 20000) {
          new Notification(latest.title, { body: latest.body });
        }
      }
    }
    void load();
    const timer = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  /* Page Visibility API active-time tracker (all roles — feeds daily_activity) */
  useEffect(() => {
    let visibleSeconds = 0;
    const tick = setInterval(() => {
      if (document.visibilityState === "visible") visibleSeconds += 1;
    }, 1000);

    const sync = setInterval(async () => {
      const payload = visibleSeconds;
      if (payload <= 0) return;
      visibleSeconds = 0;
      setSeconds((s) => s + payload);
      await fetch("/api/agent/track-time", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ seconds: payload, day: new Date().toISOString().slice(0, 10) }),
      }).catch(() => undefined);
    }, 60000);

    return () => {
      clearInterval(tick);
      clearInterval(sync);
      if (visibleSeconds > 0) {
        void fetch("/api/agent/track-time", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          body: JSON.stringify({ seconds: visibleSeconds, day: new Date().toISOString().slice(0, 10) }),
        });
      }
    };
  }, []);

  const ctx = useMemo<Ctx>(
    () => ({ user, niches, nicheId, setNicheId }),
    [user, niches, nicheId, setNicheId],
  );

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  async function returnToManagement() {
    const res = await fetch("/api/auth/impersonate", { method: "DELETE" });
    if (res.ok) {
      toast.success("Back to your management role");
      router.replace("/dashboard");
      router.refresh();
    } else {
      toast.error("Could not end the preview — reloading");
      router.refresh();
    }
  }

  const unread = notifications.length;
  const roleLabel = user.role === "AGENT" ? "Telecalling Agent" : user.role.charAt(0) + user.role.slice(1).toLowerCase();
  const isActive = (href: string) => pathname === href || (href !== "/agent" && pathname.startsWith(`${href}/`));

  const nichePicker = (
    <>
      <button
        onClick={() => setNicheId(0)}
        className={cn(
          "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold lg:w-full lg:justify-between lg:rounded-lg",
          nicheId === 0 ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600",
        )}
      >
        <span className="flex items-center gap-1.5">
          <Grid className="h-3.5 w-3.5" /> All niches
        </span>
        <ChevronRight className="hidden h-3 w-3 lg:block" />
      </button>
      {niches.map((n) => (
        <button
          key={n.id}
          onClick={() => setNicheId(n.id)}
          className={cn(
            "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-semibold lg:w-full lg:justify-between lg:rounded-lg",
            nicheId === n.id ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600",
          )}
        >
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: n.color }} />
            <span className="max-w-[140px] truncate lg:max-w-none">{n.name}</span>
          </span>
          <span className="hidden shrink-0 text-[10px] font-normal text-muted-foreground lg:block">
            {(n.total ?? 0).toLocaleString("en-IN")}
          </span>
        </button>
      ))}
    </>
  );

  const navLinks = (
    <nav className="flex-1 space-y-1 overflow-y-auto p-3 pt-2 thin-scroll">
      {navItems.map((item) => {
        const Icon = ICONS[item.icon] ?? Phone;
        const active = isActive(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => {
              setDrawer(false);
              setMoreOpen(false);
            }}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition",
              active ? "bg-blue-600 text-white shadow-sm" : "text-slate-700 hover:bg-slate-100",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="flex-1 truncate">{item.label}</span>
            {item.badge && navBadges[item.badge] > 0 ? (
              <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                {navBadges[item.badge] > 99 ? "99+" : navBadges[item.badge]}
              </span>
            ) : null}
            {active ? <ChevronRight className="h-3.5 w-3.5" /> : null}
          </Link>
        );
      })}
    </nav>
  );

  const sidebarBody = (
    <div className="flex h-full flex-col overflow-y-auto pb-[env(safe-area-inset-bottom)] thin-scroll">
      <div className="flex items-center gap-2.5 border-b px-4 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-indigo-700 text-sm font-black text-white shadow-sm">
          AGS
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-extrabold leading-tight tracking-tight">Auto Growth Systems</p>
          <p className="truncate text-[10px] font-medium text-muted-foreground">Telecalling CRM &amp; HR</p>
        </div>
        <button className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg lg:hidden" onClick={() => setDrawer(false)} aria-label="Close menu">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="border-b p-3">
        <p className="mb-2 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          <Filter className="h-3 w-3" /> Niches
        </p>
        <div className="no-scrollbar -mx-3 flex gap-1.5 overflow-x-auto px-3 lg:mx-0 lg:flex-col lg:px-0">{nichePicker}</div>
      </div>

      {navLinks}

      {/* logout pinned to the bottom of the sidebar */}
      <div className="mt-auto border-t p-3">
        <Button
          variant="outline"
          className="w-full justify-start border-rose-200 text-rose-700 hover:bg-rose-50"
          onClick={() => void logout()}
        >
          <LogOut className="h-4 w-4 shrink-0" /> Logout
        </Button>
        <button
          onClick={() => setProfileOpen(true)}
          className="mt-2 flex w-full items-center gap-2 rounded-lg p-1 text-left transition hover:bg-slate-50"
          aria-label="Open profile menu"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
            {user.name.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">{user.name}</p>
            <p className="truncate text-[10px] text-muted-foreground">Tap for profile &amp; logout</p>
          </div>
        </button>

      </div>
    </div>
  );

  const bottomShown = navItems.slice(0, 4);
  const bottomRest = navItems.slice(4);

  return (
    <AppContext.Provider value={ctx}>
      <div className="flex min-h-dvh">
        <aside className="hidden w-60 shrink-0 border-r bg-white lg:block">
          <div className="sticky top-0 h-dvh">{sidebarBody}</div>
        </aside>

        {drawer ? (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-slate-950/50" onClick={() => setDrawer(false)} />
            <div className="absolute inset-y-0 left-0 w-[85vw] max-w-xs animate-sheet bg-white shadow-2xl">{sidebarBody}</div>
          </div>
        ) : null}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex items-center gap-1.5 border-b bg-white/95 px-2 py-2 backdrop-blur sm:gap-2 sm:px-4 lg:px-6">
            <Button variant="ghost" size="icon" className="shrink-0 lg:hidden" onClick={() => setDrawer(true)} aria-label="Menu">
              <Menu className="h-5 w-5" />
            </Button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-extrabold leading-tight tracking-tight sm:text-sm">
                <span className="text-blue-700">Auto Growth</span> Systems
                <span className="mx-1.5 text-slate-300">/</span>
                <span className="font-semibold text-slate-700">
                  {navItems.find((i) => isActive(i.href))?.label ?? "Dashboard"}
                </span>
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {nicheId ? `Niche: ${niches.find((n) => n.id === nicheId)?.name}` : "All niches"} · {roleLabel}
              </p>
            </div>
            <ThemeSwitcher />
            <NotificationCenter isStaff={user.role !== "AGENT"} />
          </header>

          {/* impersonation: persistent "Return to Management Role" bar */}
          {impersonator ? (
            <div className="sticky top-[52px] z-30 flex items-center gap-2 border-b border-amber-300 bg-gradient-to-r from-amber-400 via-amber-300 to-amber-400 px-3 py-2 text-amber-950 shadow-sm sm:px-4 lg:px-6">
              <Undo2 className="h-4 w-4 shrink-0" />
              <p className="min-w-0 flex-1 truncate text-[11px] font-bold sm:text-xs">
                Previewing as <span className="underline underline-offset-2">{user.name}</span> · original role:{" "}
                {impersonator.name}
              </p>
              <Button
                size="xs"
                className="shrink-0 border-amber-900 bg-amber-900 text-amber-50 hover:bg-amber-800"
                onClick={() => void returnToManagement()}
              >
                <Undo2 className="h-3 w-3" /> Return to Management Role
              </Button>
            </div>
          ) : null}

          {/* mobile workspace header: brand + role */}
          <div className="flex items-center gap-2 border-b bg-white px-3 py-2 lg:hidden">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-600 to-indigo-700 text-[9px] font-black text-white">
              AGS
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] font-extrabold tracking-tight">Auto Growth Systems</span>
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{roleLabel}</span>
          </div>

          {/* horizontal niche strip on mobile for one-tap filtering */}
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto border-b bg-white px-2 py-2 lg:hidden">{nichePicker}</div>

          <main className="flex-1 pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-6">
            {/* site-wide persistent banner + popup layer (every tab/page) */}
            <BroadcastOverlay />
            {children}
          </main>
        </div>
      </div>

      {/* mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-white/95 backdrop-blur pb-[env(safe-area-inset-bottom)] lg:hidden">
        {bottomShown.map((item) => {
          const Icon = ICONS[item.icon] ?? Phone;
          const active = isActive(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium",
                active ? "text-blue-600" : "text-slate-500",
              )}
            >
              <Icon className="h-5 w-5 shrink-0" />
              <span className="max-w-full truncate px-0.5">{item.label.split(" ")[0]}</span>
            </Link>
          );
        })}
        {bottomRest.length ? (
          <button
            onClick={() => setMoreOpen(true)}
            className="flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium text-slate-500"
          >
            <Grid className="h-5 w-5 shrink-0" />
            More
          </button>
        ) : null}
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen} title="All sections" description={`${roleLabel} navigation`}>
        <div className="grid gap-2">
          {navItems.map((item) => {
            const Icon = ICONS[item.icon] ?? Phone;
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMoreOpen(false)}
                className={cn(
                  "flex items-center gap-3 rounded-xl border p-3 text-sm font-medium",
                  active ? "border-blue-300 bg-blue-50 text-blue-700" : "bg-white",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1 truncate">{item.label}</span>
                {item.badge && navBadges[item.badge] > 0 ? (
                  <span className="mr-1 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                    {navBadges[item.badge]}
                  </span>
                ) : null}
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            );
          })}
        </div>
      </Sheet>

      {/* automated management decision popups (approve / reject) */}
      <DecisionNoticeOverlay />

      {/* ---------- profile avatar menu ---------- */}
      <Sheet
        open={profileOpen}
        onOpenChange={setProfileOpen}
        title={user.name}
        description={`${roleLabel} · ${user.email}`}
      >
        <div className="space-y-2">
          <div className="flex items-center gap-3 rounded-xl border p-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">
              {user.name.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{user.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">{user.email}</p>
              <Badge variant="muted" className="mt-1">{roleLabel}</Badge>
            </div>
          </div>

          {user.role === "AGENT" ? (
            <a href="/agent/profile" className="flex items-center gap-2 rounded-xl border p-3 text-sm font-medium hover:bg-slate-50">
              <IdCard className="h-4 w-4" /> My Profile, ID Card &amp; KYC
            </a>
          ) : (
            <a href="/agents" className="flex items-center gap-2 rounded-xl border p-3 text-sm font-medium hover:bg-slate-50">
              <Users className="h-4 w-4" /> Team &amp; Agents
            </a>
          )}

          <div className="rounded-xl border p-3">
            <p className="text-[11px] text-muted-foreground">Signed in to</p>
            <p className="text-sm font-extrabold tracking-tight">Auto Growth Systems</p>
          </div>

          <Button
            variant="destructive"
            size="lg"
            className="w-full"
            onClick={() => void logout()}
          >
            <LogOut className="h-4 w-4" /> Logout
          </Button>
        </div>
      </Sheet>
    </AppContext.Provider>
  );
}
