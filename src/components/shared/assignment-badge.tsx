import { Users } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Assignment state is DECOUPLED from pipeline status.
 * A lead can be Status: "No Response" / Assigned To: "Pool", or
 * Status: "New" / Assigned To: "Suresh Patel" — both render independently.
 */
export function AssignedToBadge({
  agent,
  className,
  size = "sm",
}: {
  agent: { id: string; name: string; role?: string; isOnline?: boolean } | null | undefined;
  className?: string;
  size?: "xs" | "sm";
}) {
  const pool = !agent;

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border font-semibold",
        size === "xs" ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]",
        pool ? "border-stone-300 bg-stone-100 text-stone-600" : "border-blue-200 bg-blue-50 text-blue-700",
        className,
      )}
      title={pool ? "Assignment: Pool (no owner)" : `Assignment: ${agent!.name}`}
    >
      {pool ? (
        <>
          <Users className={size === "xs" ? "h-2.5 w-2.5" : "h-3 w-3"} />
          <span className="truncate">Pool</span>
        </>
      ) : (
        <>
          <span
            className={cn(
              "shrink-0 rounded-full text-white",
              size === "xs" ? "h-2.5 w-2.5 text-[7px]" : "h-3.5 w-3.5 text-[7px]",
              "flex items-center justify-center font-bold",
              avatarTint(agent!.id),
            )}
          >
            {initials(agent!.name)}
          </span>
          <span className="truncate">{agent!.name}</span>
        </>
      )}
    </span>
  );
}

/** Labelled pair used in tables and detail views: "Status: X" / "Assigned To: Y". */
export function AssignmentRow({
  status,
  statusLabel,
  statusClassName,
  agent,
  className,
}: {
  status: string;
  statusLabel?: string;
  statusClassName?: string;
  agent: { id: string; name: string; role?: string; isOnline?: boolean } | null | undefined;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      <span className="inline-flex items-center gap-1 text-[10px]">
        <span className="text-muted-foreground">Status:</span>
        <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 font-semibold", statusClassName ?? "border-slate-200 bg-slate-100 text-slate-700")}>
          {statusLabel ?? status.replace(/_/g, " ")}
        </span>
      </span>
      <span className="inline-flex items-center gap-1 text-[10px]">
        <span className="text-muted-foreground">Assigned To:</span>
        <AssignedToBadge agent={agent} size="xs" />
      </span>
    </div>
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function avatarTint(id: string | number) {
  const palette = ["bg-blue-600", "bg-emerald-600", "bg-violet-600", "bg-orange-600", "bg-rose-600", "bg-teal-600", "bg-indigo-600"];
  const text = String(id ?? "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length] ?? "bg-blue-600";
}
