"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { TrackedEvent } from "@/lib/activity-tracking";

export type TrackerState = {
  /** optimistic local count of interactions this session */
  sessionClicks: number;
  /** authoritative counters from the server (today) */
  clicks: number;
  actions: number;
  navigations: number;
  leadOpens: number;
  used: number;
  limit: number | null;
  remaining: number | null;
  locked: boolean;
  /** last server sync timestamp (ms precision) */
  lastSync: string;
  /** true while a flush is in flight */
  syncing: boolean;
};

const FLUSH_INTERVAL_MS = 5000;
const MAX_BATCH = 100;

/** Human label for a DOM node so the audit trail is readable. */
function describeTarget(el: Element | null): string | null {
  if (!el) return null;
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  const aria = el.getAttribute("aria-label");
  const title = el.getAttribute("title");
  const id = el.id ? `#${el.id}` : "";
  const label = aria || title || (text ? text.slice(0, 60) : "");
  const tag = el.tagName.toLowerCase();
  return label ? `${tag}${id} "${label}"`.slice(0, 180) : `${tag}${id}`.slice(0, 180);
}

function isInteractive(el: Element): boolean {
  const t = el.tagName.toLowerCase();
  if (["button", "a", "input", "select", "textarea", "summary"].includes(t)) return true;
  if (el.getAttribute("role") === "button") return true;
  if (el.hasAttribute("data-track")) return true;
  return false;
}

/**
 * Global interaction tracker.
 *
 * Captures every meaningful click, button interaction and navigation path,
 * batches them and flushes every 5 seconds to /api/agent/track-interaction
 * (one request per flush — cheap enough for 50+ agents).
 *
 * Also enforces the Click Quota client-side: once the server reports the
 * agent is locked, `locked` flips to true and the caller can block actions.
 */
export function useInteractionTracker(options: { enabled?: boolean; onLocked?: (locked: boolean) => void } = {}) {
  const enabled = options.enabled !== false;
  const pathname = usePathname();
  const bufferRef = useRef<TrackedEvent[]>([]);
  const sessionClicksRef = useRef(0);
  const sessionIdRef = useRef<string>("");
  const activeSecondsRef = useRef(0);
  const lastPathRef = useRef<string>("");
  const lockedRef = useRef(false);

  const [state, setState] = useState<TrackerState>({
    sessionClicks: 0,
    clicks: 0,
    actions: 0,
    navigations: 0,
    leadOpens: 0,
    used: 0,
    limit: null,
    remaining: null,
    locked: false,
    lastSync: "",
    syncing: false,
  });

  /* ---------- stable session id ---------- */
  useEffect(() => {
    const KEY = "ags-session-id";
    let sid = "";
    try {
      sid = window.sessionStorage.getItem(KEY) ?? "";
      if (!sid) {
        sid = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
        window.sessionStorage.setItem(KEY, sid);
      }
    } catch {
      sid = `s_${Date.now().toString(36)}`;
    }
    sessionIdRef.current = sid;
  }, []);

  const push = useCallback((event: TrackedEvent) => {
    if (lockedRef.current) return;
    if (bufferRef.current.length >= MAX_BATCH) bufferRef.current.shift();
    bufferRef.current.push(event);
    sessionClicksRef.current += 1;
    setState((s) => ({ ...s, sessionClicks: sessionClicksRef.current }));
  }, []);

  /* ---------- capture clicks ---------- */
  useEffect(() => {
    if (!enabled) return;
    const onClick = (e: MouseEvent) => {
      const el = e.target as Element | null;
      if (!el || !isInteractive(el)) return;
      const target = describeTarget(el);
      push({ type: "CLICK", target, path: window.location.pathname });
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, [enabled, push]);

  /* ---------- capture navigations ---------- */
  useEffect(() => {
    if (!enabled || !pathname) return;
    if (lastPathRef.current === pathname) return;
    const previous = lastPathRef.current;
    lastPathRef.current = pathname;
    if (!previous) return; // first render — not a navigation
    push({ type: "NAVIGATION", target: pathname, path: pathname, meta: { from: previous } });
  }, [enabled, pathname, push]);

  /* ---------- visible-tab heartbeat (active seconds) ---------- */
  useEffect(() => {
    if (!enabled) return;
    const tick = setInterval(() => {
      if (document.visibilityState === "visible") activeSecondsRef.current += 1;
    }, 1000);
    return () => clearInterval(tick);
  }, [enabled]);

  /* ---------- flush every 5 seconds ---------- */
  const flush = useCallback(async () => {
    if (!enabled) return;
    const events = bufferRef.current.splice(0, MAX_BATCH);
    const activeSeconds = activeSecondsRef.current;
    activeSecondsRef.current = 0;
    if (events.length === 0 && activeSeconds === 0) return;

    setState((s) => ({ ...s, syncing: true }));
    try {
      const res = await fetch("/api/agent/track-interaction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: sessionIdRef.current,
          platform: navigator.userAgent.slice(0, 120),
          activeSeconds,
          events,
        }),
        keepalive: true,
      });
      if (!res.ok) return;
      const json = (await res.json()) as {
        quota?: {
          clicks: number;
          actions: number;
          navigations: number;
          leadOpens: number;
          used: number;
          limit: number | null;
          remaining: number | null;
          locked: boolean;
        };
      };
      if (!json.quota) return;
      const q = json.quota;
      setState((s) => ({
        ...s,
        clicks: q.clicks,
        actions: q.actions,
        navigations: q.navigations,
        leadOpens: q.leadOpens,
        used: q.used,
        limit: q.limit,
        remaining: q.remaining,
        locked: q.locked,
        lastSync: new Date().toLocaleTimeString("en-GB", {
          hour12: false,
          fractionalSecondDigits: 3,
        } as Intl.DateTimeFormatOptions),
        syncing: false,
      }));
      if (lockedRef.current !== q.locked) {
        lockedRef.current = q.locked;
        options.onLocked?.(q.locked);
      }
    } catch {
      // offline — the buffer was already drained, so re-add on failure
      bufferRef.current.unshift(...events);
      setState((s) => ({ ...s, syncing: false }));
    }
  }, [enabled, options]);

  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onHide);
      void flush();
    };
  }, [enabled, flush]);

  /* ---------- expose an imperative API for lead open/close + actions ---------- */
  const trackAction = useCallback(
    (target: string, meta?: Record<string, unknown>) => {
      push({ type: "ACTION", target, path: window.location.pathname, meta: meta ?? null });
    },
    [push],
  );

  const trackLeadOpen = useCallback(
    async (leadId: number, action = "OPEN") => {
      const openedAt = Date.now();
      try {
        const res = await fetch("/api/agent/lead-open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leadId,
            action,
            path: window.location.pathname,
            platform: navigator.userAgent.slice(0, 120),
          }),
        });
        const json = (await res.json().catch(() => ({}))) as { locked?: boolean };
        if (json.locked) {
          lockedRef.current = true;
          setState((s) => ({ ...s, locked: true }));
          return false;
        }
        push({ type: "LEAD_OPEN", target: `lead:${leadId}`, path: window.location.pathname, meta: { action } });
        return true;
      } catch {
        return true; // never block the agent on telemetry failure
      }
    },
    [push],
  );

  const trackLeadClose = useCallback(
    (leadId: number, openedAt: number) => {
      const durationMs = Math.max(0, Date.now() - openedAt);
      void fetch("/api/agent/lead-open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, close: true, durationMs }),
        keepalive: true,
      }).catch(() => undefined);
    },
    [],
  );

  return { state, flush, trackAction, trackLeadOpen, trackLeadClose, sessionId: sessionIdRef.current };
}
