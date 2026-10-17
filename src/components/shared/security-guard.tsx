"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useSecurityGuard } from "@/lib/use-security-guard";
import { useInteractionTracker } from "@/lib/use-interaction-tracker";
import { toast } from "sonner";

export type InteractionState = {
  /** optimistic count of interactions in this browser session */
  sessionClicks: number;
  /** authoritative counters for today (server-synced) */
  clicks: number;
  actions: number;
  navigations: number;
  leadOpens: number;
  used: number;
  /** null = unlimited */
  limit: number | null;
  remaining: number | null;
  locked: boolean;
  /** last sync timestamp with millisecond precision */
  lastSync: string;
  syncing: boolean;
};

type Ctx = {
  state: InteractionState;
  trackAction: (target: string, meta?: Record<string, unknown>) => void;
  trackLeadOpen: (leadId: number, action?: string) => Promise<boolean>;
  trackLeadClose: (leadId: number, openedAt: number) => void;
  flush: () => Promise<void>;
};

const InteractionContext = createContext<Ctx | null>(null);

/** Read the live interaction state anywhere under <SecurityGuard>. */
export function useInteraction() {
  const ctx = useContext(InteractionContext);
  if (!ctx) throw new Error("useInteraction must be used inside <SecurityGuard>");
  return ctx;
}

/**
 * Mounts the enterprise UI protections and the interaction tracker for the
 * whole authenticated app. Rendered once in the (app) layout.
 *
 * - useSecurityGuard: right-click, devtools shortcuts, selection, dragging,
 *   long-press and copy blocking.
 * - useInteractionTracker: batches every click/action/navigation to the
 *   server and enforces the Click Quota (locks the agent when exhausted).
 */
export function SecurityGuard({ role, children }: { role?: string; children?: ReactNode }) {
  const isAgent = role === "AGENT";
  const [locked, setLocked] = useState(false);

  useSecurityGuard({ enabled: true });

  const { state, trackAction, trackLeadOpen, trackLeadClose, flush } = useInteractionTracker({
    enabled: true,
    onLocked: (isLocked) => {
      setLocked(isLocked);
      if (isLocked) {
        toast.error(
          "Daily click quota reached — actions are locked for today. Contact your manager to raise the limit.",
          { duration: 8000 },
        );
      }
    },
  });

  // Warn at 80% of the quota — a heads-up before the agent gets locked out.
  useEffect(() => {
    if (state.limit === null || state.locked) return;
    const pct = state.used / state.limit;
    if (pct >= 0.8 && pct < 1 && isAgent) {
      toast.warning(
        `You've used ${state.used} of ${state.limit} daily actions (${Math.round(pct * 100)}%).`,
        { id: "click-quota-warning", duration: 5000 },
      );
    }
  }, [state.used, state.limit, state.locked, isAgent]);

  const value = useMemo<Ctx>(
    () => ({ state, trackAction, trackLeadOpen, trackLeadClose, flush }),
    [state, trackAction, trackLeadOpen, trackLeadClose, flush],
  );

  return (
    <InteractionContext.Provider value={value}>
      <div aria-hidden data-quota-locked={locked ? "true" : "false"} style={{ display: "none" }} />
      {children}
    </InteractionContext.Provider>
  );
}
