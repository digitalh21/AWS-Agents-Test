"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> & {
  onValueChange?: (value: string) => void;
  /** strips everything except digits and an optional single decimal point */
  allowDecimal?: boolean;
};

/**
 * Scroll / swipe / arrow-key safe numeric input.
 *
 * Browsers (especially mobile) mutate number inputs on wheel, trackpad swipe and
 * touch drag, and spin the value with the arrow keys. This component:
 *   - renders type="text" with inputMode so the OS keyboard is numeric
 *     but the browser never owns the value,
 *   - blocks wheel + touch scroll from reaching the field,
 *   - swallows ArrowUp / ArrowDown / PageUp / PageDown,
 *   - keeps the caret where the user was typing while stripping bad characters.
 */
export const NumberInput = React.forwardRef<HTMLInputElement, Props>(
  ({ className, onValueChange, allowDecimal = true, value, onBlur, ...props }, ref) => {
    const innerRef = React.useRef<HTMLInputElement | null>(null);
    const caret = React.useRef<number | null>(null);

    const setRef = (node: HTMLInputElement | null) => {
      innerRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref && typeof ref === "object") (ref as React.RefObject<HTMLInputElement | null>).current = node;
    };

    const clean = (raw: string) => {
      let next = allowDecimal ? raw.replace(/[^0-9.]/g, "") : raw.replace(/[^0-9]/g, "");
      if (allowDecimal) {
        const first = next.indexOf(".");
        if (first !== -1) next = next.slice(0, first + 1) + next.slice(first + 1).replace(/\./g, "");
      }
      return next;
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const el = e.target;
      const next = clean(el.value);
      caret.current = el.selectionStart;
      onValueChange?.(next);
      // restore caret after React re-renders with the cleaned value
      requestAnimationFrame(() => {
        const node = innerRef.current;
        if (!node) return;
        const pos = Math.min(caret.current ?? next.length, next.length);
        try {
          node.setSelectionRange(pos, pos);
        } catch {
          /* not focusable, ignore */
        }
      });
    };

    return (
      <input
        {...props}
        ref={setRef}
        type="text"
        inputMode={allowDecimal ? "decimal" : "numeric"}
        // hints password managers / autofill off so nothing rewrites the value
        autoComplete="off"
        data-form-type="other"
        data-1p-ignore
        spellCheck={false}
        value={(value as string | number | undefined) ?? ""}
        onChange={handleChange}
        onWheel={(e) => {
          // never let a scroll mutate or move the value
          e.currentTarget.blur();
          e.stopPropagation();
        }}
        onTouchMove={(e) => {
          e.stopPropagation();
        }}
        onKeyDown={(e) => {
          if (["ArrowUp", "ArrowDown", "PageUp", "PageDown"].includes(e.key)) {
            e.preventDefault();
            return;
          }
          props.onKeyDown?.(e);
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          const next = clean(text);
          if (next !== text) {
            e.preventDefault();
            onValueChange?.(clean(String(value ?? "") + next));
          }
          props.onPaste?.(e);
        }}
        onBlur={onBlur}
        className={cn("tabular-nums", className)}
      />
    );
  },
);
NumberInput.displayName = "NumberInput";
