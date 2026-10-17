"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Moon, Palette, Sprout, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

export type ThemeKey = "day" | "dark" | "grown";

const THEMES: Array<{
  key: ThemeKey;
  label: string;
  hint: string;
  icon: typeof Sun;
  swatch: string;
}> = [
  { key: "day", label: "Day Mode", hint: "Clean light theme", icon: Sun, swatch: "bg-sky-100 border border-sky-300" },
  { key: "dark", label: "Dark Mode", hint: "Sleek dark theme", icon: Moon, swatch: "bg-slate-800 border border-slate-600" },
  { key: "grown", label: "Grown Mode", hint: "Earth-tone neutral", icon: Sprout, swatch: "bg-[#e6ddc9] border border-[#b0a480]" },
];

function applyTheme(key: ThemeKey) {
  document.documentElement.dataset.theme = key;
  try {
    window.localStorage.setItem("ags-theme", key);
  } catch {
    /* private mode */
  }
}

/** Global triple-theme selector (Day / Dark / Grown). Persisted per device. */
export function ThemeSwitcher() {
  const [theme, setTheme] = useState<ThemeKey>("day");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const current = (document.documentElement.dataset.theme as ThemeKey) || "day";
    setTheme(THEMES.some((t) => t.key === current) ? current : "day");
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const Active = THEMES.find((t) => t.key === theme) ?? THEMES[0]!;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-label={`Theme: ${Active.label}. Click to change.`}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-xl border bg-white text-slate-600 transition hover:bg-slate-50"
      >
        <Palette className="h-4 w-4" />
      </button>
      {open ? (
        <div className="absolute right-0 top-11 z-50 w-56 animate-sheet rounded-2xl border bg-white p-1.5 shadow-xl">
          <p className="px-2 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Interface theme</p>
          {THEMES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setTheme(t.key);
                applyTheme(t.key);
                setOpen(false);
              }}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition hover:bg-slate-50",
                theme === t.key && "bg-slate-50",
              )}
            >
              <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", t.swatch)}>
                <t.icon className="h-4 w-4 text-slate-700" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-bold">{t.label}</span>
                <span className="block truncate text-[10px] text-muted-foreground">{t.hint}</span>
              </span>
              {theme === t.key ? <Check className="h-4 w-4 shrink-0 text-emerald-600" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
