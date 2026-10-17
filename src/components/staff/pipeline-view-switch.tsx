"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Kanban, LayoutList } from "lucide-react";
import { cn } from "@/lib/utils";

/** Board / Table switch rendered above the pipeline views. */
export function PipelineViewSwitch({ initial }: { initial: string }) {
  const pathname = usePathname();
  const current = initial || "board";

  const tabs = [
    { key: "board", label: "Kanban Pipeline", icon: Kanban },
    { key: "table", label: "Data Table", icon: LayoutList },
  ];

  return (
    <div className="flex gap-1 border-b bg-white px-3 pt-2 sm:px-4 lg:px-6">
      {tabs.map((t) => {
        const active = current === t.key;
        return (
          <Link
            key={t.key}
            href={`${pathname}${t.key === "table" ? "?view=table" : ""}`}
            className={cn(
              "flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-xs font-semibold transition",
              active ? "bg-blue-50 text-blue-700" : "text-slate-500 hover:bg-slate-50",
            )}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
