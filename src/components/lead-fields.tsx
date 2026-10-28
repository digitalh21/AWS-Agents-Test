"use client";

import { ExternalLink, EyeOff, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Dynamic field renderer driven by the admin visibility matrix.
 * The API nulls HIDDEN fields and obfuscates MASKED fields, and tags them with
 * `__hidden` / `__masked` so the UI can explain *why* a value is unavailable.
 */
export type PolicyField = {
  key: string;
  label: string;
  value: unknown;
  hidden?: boolean;
  masked?: boolean;
  render?: "link" | "phone" | "status";
};

export function FieldValue({ field, className }: { field: PolicyField; className?: string }) {
  const raw = field.value === null || field.value === undefined || field.value === "" ? null : String(field.value);

  if (field.hidden) {
    return (
      <span className={cn("inline-flex items-center gap-1 rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500", className)}>
        <EyeOff className="h-3 w-3" /> Hidden by admin
      </span>
    );
  }
  if (!raw) return <span className={cn("text-muted-foreground", className)}>—</span>;

  if (field.masked) {
    return (
      <span className={cn("inline-flex items-center gap-1 rounded-md bg-amber-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-amber-700", className)}>
        <Lock className="h-2.5 w-2.5" /> {raw}
      </span>
    );
  }

  if (field.render === "link") {
    return (
      <a
        href={raw.startsWith("http") ? raw : `https://${raw}`}
        target="_blank"
        rel="noreferrer"
        className={cn("inline-flex max-w-full items-center gap-1 truncate text-blue-600 underline decoration-dotted", className)}
      >
        <span className="truncate">{raw.replace(/^https?:\/\//, "")}</span>
        <ExternalLink className="h-3 w-3 shrink-0" />
      </a>
    );
  }

  return <span className={cn("truncate", className)}>{raw}</span>;
}

/** Compact 2-col grid of policy-driven fields (mobile-first). */
export function FieldGrid({ fields, className }: { fields: PolicyField[]; className?: string }) {
  const shown = fields.filter((f) => !f.hidden);
  if (shown.length === 0) return null;
  return (
    <dl className={cn("grid grid-cols-2 gap-2 sm:grid-cols-3", className)}>
      {shown.map((f) => (
        <div key={f.key} className="min-w-0 rounded-lg bg-slate-50 p-2">
          <dt className="truncate text-[9px] uppercase tracking-wide text-muted-foreground sm:text-[10px]">{f.label}</dt>
          <dd className="mt-0.5 text-xs font-medium">
            <FieldValue field={f} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Builds PolicyField descriptors from a projected lead + the viewer's policy map. */
export function toPolicyFields(
  lead: Record<string, unknown>,
  labels: Record<string, string>,
  policyMap: Record<string, string> = {},
  renderers: Record<string, "link" | "phone" | "status"> = {},
): PolicyField[] {
  return Object.entries(labels).map(([key, label]) => ({
    key,
    label,
    value: lead[key] ?? null,
    hidden: Boolean(lead[`${key}__hidden`]) || policyMap[key] === "HIDDEN",
    masked: Boolean(lead[`${key}__masked`]) || policyMap[key] === "MASKED",
    render: renderers[key],
  }));
}
