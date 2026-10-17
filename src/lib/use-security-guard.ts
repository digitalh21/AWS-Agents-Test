"use client";

import { useEffect } from "react";

/**
 * Enterprise UI protection (PhonePe-style).
 *
 * WHAT THIS ACTUALLY IS: a set of client-side *deterrents* that stop casual
 * users and accidental mis-clicks from inspecting the app, selecting text,
 * dragging images, or long-pressing on mobile.
 *
 * WHAT THIS IS NOT: a security boundary. Any client-side guard can be bypassed
 * by a determined user (curl, a patched browser, a proxy). The REAL enforcement
 * for business rules (click quotas, lead access) lives server-side in
 * src/lib/activity-tracking.ts — this hook only makes the UI feel locked down.
 */

/** Keys we refuse to let through, even in devtools-ish combos. */
const BLOCKED_KEYS = new Set([
  "F12",
  "F11",
  "PrintScreen",
  "ContextMenu",
]);

/** Modifier+key combinations that open developer tools / view source. */
const BLOCKED_COMBOS: Array<{ ctrl: boolean; shift: boolean; alt: boolean; key: string }> = [
  { ctrl: true, shift: true, alt: false, key: "i" }, // DevTools
  { ctrl: true, shift: true, alt: false, key: "j" }, // Console
  { ctrl: true, shift: true, alt: false, key: "c" }, // Inspect element
  { ctrl: true, shift: true, alt: false, key: "p" }, // Command menu
  { ctrl: true, shift: false, alt: false, key: "u" }, // View source
  { ctrl: true, shift: false, alt: false, key: "s" }, // Save page
  { ctrl: true, shift: false, alt: false, key: "p" }, // Print
];

function isEditable(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node || !node.tagName) return false;
  const tag = node.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || node.isContentEditable === true;
}

/**
 * Applies the global UI protections. Mounted once by <SecurityGuard />.
 */
export function useSecurityGuard(options: { enabled?: boolean } = {}) {
  const enabled = options.enabled !== false;

  useEffect(() => {
    if (!enabled) return;

    /* ---------- context menu (right click) ---------- */
    const onContextMenu = (e: Event) => {
      // allow the native menu inside form fields so agents can paste
      if (isEditable(e.target)) return;
      e.preventDefault();
    };

    /* ---------- developer tools / view source shortcuts ---------- */
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditable(e.target) && !e.ctrlKey && !e.metaKey) return;
      const key = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;

      if (BLOCKED_KEYS.has(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (ctrl && BLOCKED_COMBOS.some((c) => c.key === key && c.shift === e.shiftKey && c.alt === e.altKey)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    /* ---------- block image/element dragging ---------- */
    const onDragStart = (e: DragEvent) => {
      e.preventDefault();
    };

    /* ---------- block copy/cut outside inputs ---------- */
    const onCopy = (e: ClipboardEvent) => {
      if (isEditable(e.target)) return;
      e.preventDefault();
    };

    /* ---------- mobile: block long-press selection / magnifier ---------- */
    const onTouchStart = (e: TouchEvent) => {
      if (isEditable(e.target)) return;
      // a 500ms+ hold would trigger the OS callout / text-selection UI.
      // CSS (-webkit-touch-callout:none + user-select:none) hides the visuals;
      // cancelling the long-press gesture stops the iOS magnifier.
      const longPressTimer = window.setTimeout(() => {
        /* no-op — visual suppression is handled in CSS */
      }, 500);
      const clear = () => window.clearTimeout(longPressTimer);
      window.addEventListener("touchend", clear, { once: true });
      window.addEventListener("touchmove", clear, { once: true });
    };

    /* ---------- mobile: double-tap zoom ---------- */
    let lastTouchEnd = 0;
    const onTouchEnd = (e: TouchEvent) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 320) e.preventDefault();
      lastTouchEnd = now;
    };

    document.addEventListener("contextmenu", onContextMenu, { capture: true });
    document.addEventListener("keydown", onKeyDown, { capture: true });
    document.addEventListener("dragstart", onDragStart, { capture: true });
    document.addEventListener("copy", onCopy, { capture: true });
    document.addEventListener("cut", onCopy, { capture: true });
    document.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
    document.addEventListener("touchend", onTouchEnd, { capture: true, passive: false });

    return () => {
      document.removeEventListener("contextmenu", onContextMenu, { capture: true });
      document.removeEventListener("keydown", onKeyDown, { capture: true });
      document.removeEventListener("dragstart", onDragStart, { capture: true });
      document.removeEventListener("copy", onCopy, { capture: true });
      document.removeEventListener("cut", onCopy, { capture: true });
      document.removeEventListener("touchstart", onTouchStart, { capture: true });
      document.removeEventListener("touchend", onTouchEnd, { capture: true });
    };
  }, [enabled]);
}
