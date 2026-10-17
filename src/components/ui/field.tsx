import * as React from "react";
import { cn } from "@/lib/utils";

const base =
  "flex w-full min-w-0 rounded-lg border border-[var(--color-input)] bg-white px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)] disabled:cursor-not-allowed disabled:bg-[var(--color-muted)]";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(base, "h-11 text-base sm:h-10 sm:text-sm", className)} {...props} />,
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(base, "min-h-[96px] resize-y sm:min-h-[84px]", className)} {...props} />
  ),
);
Textarea.displayName = "Textarea";

export const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(base, "h-11 appearance-none bg-white pr-8 text-base sm:h-10 sm:text-sm", className)}
    {...props}
  />
));
NativeSelect.displayName = "NativeSelect";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-xs font-medium text-muted-foreground", className)} {...props} />;
}

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: "default" | "outline" | "muted" | "success" | "warn" | "danger" }) {
  const variants: Record<string, string> = {
    default: "bg-[var(--color-primary)] text-white border-transparent",
    outline: "bg-white text-foreground",
    muted: "bg-[var(--color-muted)] text-muted-foreground border-transparent",
    success: "bg-emerald-50 text-emerald-700 border-emerald-200",
    warn: "bg-amber-50 text-amber-700 border-amber-200",
    danger: "bg-rose-50 text-rose-700 border-rose-200",
  };
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "default" | "success" | "warn" | "danger" | "info";
  className?: string;
}) {
  const tones: Record<string, string> = {
    default: "text-foreground",
    success: "text-emerald-600",
    warn: "text-amber-600",
    danger: "text-rose-600",
    info: "text-blue-600",
  };
  return (
    <div className={cn("min-w-0 rounded-xl border bg-card p-2.5 shadow-sm sm:p-3", className)}>
      <p className="truncate text-[9px] font-semibold uppercase tracking-wider text-muted-foreground sm:text-[10px]">
        {label}
      </p>
      <p className={cn("mt-0.5 truncate text-lg font-bold tabular-nums sm:text-xl", tones[tone])}>{value}</p>
      {hint ? <p className="mt-0.5 truncate text-[10px] text-muted-foreground sm:text-[11px]">{hint}</p> : null}
    </div>
  );
}

export function EmptyState({ title, hint, icon }: { title: string; hint?: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed p-6 text-center sm:p-8">
      <div className="text-2xl">{icon ?? "📭"}</div>
      <p className="text-sm font-medium">{title}</p>
      {hint ? <p className="max-w-xs text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function SectionCard({
  title,
  icon,
  action,
  children,
  className,
}: {
  title: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border bg-white p-3 sm:p-4", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground sm:text-xs">
          {icon}
          <span className="truncate">{title}</span>
        </p>
        {action}
      </div>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** Phone-only card list that pairs with a desktop table (`hidden lg:block`). */
export function MobileList({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("space-y-2 lg:hidden", className)}>{children}</div>;
}

/** Shell for the desktop table that pairs with `MobileList`. */
export function DesktopTable({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("hidden overflow-hidden rounded-xl border bg-white lg:block", className)}>
      <div className="overflow-x-auto thin-scroll">{children}</div>
    </div>
  );
}
