"use client";

import { useEffect, useState } from "react";
import { num } from "@/lib/utils";
import { cn } from "@/lib/utils";

const STAGES = [
  { key: "ALL", label: "All", tone: "text-foreground" },
  { key: "IN_PROGRESS", label: "In Process", tone: "text-blue-600" },
  { key: "CALLBACK", label: "Call Back", tone: "text-amber-600" },
  { key: "NO_RESPONSE", label: "No Response", tone: "text-orange-600" },
  { key: "PAYMENT_APPROVAL", label: "Payment Approval", tone: "text-violet-600" },
  { key: "REJECTED", label: "Reject/Not Interest", tone: "text-rose-600" },
];

/**
 * Exact pipeline stage counters shared by the board, the table and the agent queue.
 * All three call the same /api/pipeline/counts endpoint so the numbers can never drift.
 */
export function StageCounters({
  scope,
  nicheId = 0,
  agentId = "",
  q = "",
  pipeline = "assigned",
  className,
}: {
  scope: "staff" | "agent";
  nicheId?: number;
  agentId?: string;
  q?: string;
  /** which board the counters describe */
  pipeline?: "assigned" | "unassigned";
  className?: string;
}) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [meta, setMeta] = useState<string>("");

  useEffect(() => {
    const params = new URLSearchParams({ scope });
    if (scope === "agent") params.set("mine", "true");
    if (scope === "staff") params.set("pipeline", pipeline);
    if (agentId) params.set("agentId", String(agentId));
    if (nicheId) params.set("nicheId", String(nicheId));
    if (q.trim()) params.set("q", q.trim());

    let alive = true;
    void fetch(`/api/pipeline/counts?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { counters?: Record<string, number>; scope?: { niches?: string; mine?: boolean } } | null) => {
        if (!j || !alive) return;
        setCounts(j.counters ?? {});
        setMeta(
          [j.scope?.mine ? "my queue" : "whole book", j.scope?.niches === "filtered" ? "niche filtered" : "all niches"]
            .filter(Boolean)
            .join(" · "),
        );
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [scope, nicheId, agentId, q, pipeline]);

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="grid grid-cols-3 gap-2 lg:grid-cols-6">
        {STAGES.map((stage) => (
          <div key={stage.key} className="min-w-0 rounded-xl border bg-white p-2.5 shadow-sm">
            <p className="truncate text-[9px] font-semibold uppercase tracking-wider text-muted-foreground sm:text-[10px]">
              {stage.label}
            </p>
            <p className={cn("mt-0.5 truncate text-lg font-bold tabular-nums sm:text-xl", stage.tone)}>
              {num(counts[stage.key] ?? 0)}
            </p>
          </div>
        ))}
      </div>
      {meta ? <p className="px-1 text-[10px] text-muted-foreground">{meta}</p> : null}
    </div>
  );
}
