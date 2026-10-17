"use client";

import { useEffect, useMemo, useState } from "react";
import { History, Loader2, Pencil, Save, UserCog } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Label, NativeSelect } from "@/components/ui/field";
import { dateTime } from "@/lib/utils";

export type HistoryEntry = {
  id: number;
  fieldName: string;
  oldValue: string | null;
  newValue: string | null;
  changedByName: string | null;
  changedByRole: string | null;
  createdAt: string;
};

type Agent = { id: string; name: string; role: string };

/** camelCase field key -> the snake_case name agents' payloads may use instead. */
const EDITABLE: Array<{ key: string; label: string; type?: "text" | "num" }> = [
  { key: "businessName", label: "Business name" },
  { key: "contactName", label: "Contact person" },
  { key: "phone", label: "Phone" },
  { key: "mobileNo", label: "Alternate mobile" },
  { key: "email", label: "Email" },
  { key: "city", label: "City" },
  { key: "cityKeyword", label: "City keyword" },
  { key: "address", label: "Address" },
  { key: "website", label: "Website" },
  { key: "websiteUrl", label: "Website URL" },
  { key: "gmapLink", label: "Google Maps link" },
  { key: "opensAt", label: "Opens at" },
  { key: "websiteStatus", label: "Website status" },
  { key: "serviceStatus", label: "Service status" },
  { key: "statusService", label: "Status service" },
  { key: "callStatus", label: "Call status" },
  { key: "competitorName", label: "Competitor" },
  { key: "reviewsCount", label: "Reviews", type: "num" },
  { key: "competitorReviews", label: "Competitor reviews", type: "num" },
  { key: "rating", label: "Rating", type: "num" },
  { key: "nicheCategory", label: "Niche category" },
  { key: "title", label: "Title" },
  { key: "leadStatus", label: "Lead status (HOT/WARM/COLD)" },
  { key: "dealAmount", label: "Deal amount", type: "num" },
  { key: "leadCloseAmount", label: "Close amount", type: "num" },
  { key: "leadCode", label: "Lead code" },
  { key: "backendCheckNote", label: "Backed Check note" },
];

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/**
 * Management-only lead inspector: edit ANY field (each save writes the
 * lead_history timeline) and reassign the owner in place.
 */
export function LeadEditPanel({
  leadId,
  lead,
  onSaved,
}: {
  leadId: number;
  lead: Record<string, unknown>;
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [agents, setAgents] = useState<Agent[]>([]);
  const [assignTo, setAssignTo] = useState<string>("");

  const val = (key: string) => {
    const v = lead[key] ?? lead[snake(key)];
    return v === null || v === undefined ? "" : String(v);
  };

  useEffect(() => {
    if (!open) return;
    void fetch("/api/agents")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { rows?: Agent[] } | null) => setAgents((j?.rows ?? []).filter((a) => a.role === "AGENT")))
      .catch(() => undefined);
  }, [open]);

  const changed = useMemo(() => {
    const out: Record<string, string | null> = {};
    for (const f of EDITABLE) {
      if (draft[f.key] !== undefined && draft[f.key] !== val(f.key)) out[f.key] = draft[f.key] === "" ? null : draft[f.key];
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, lead]);

  async function save() {
    setBusy(true);
    const res = await fetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "update", fields: changed }),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: string; changed?: string[] };
    if (res.ok) {
      toast.success(`Saved ${json.changed?.length ?? Object.keys(changed).length} field change(s) — logged to lead history`);
      setDraft({});
      onSaved?.();
    } else toast.error(json.error ?? "Save failed");
    setBusy(false);
  }

  async function reassign(agentId: string) {
    setBusy(true);
    const res = await fetch(`/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "assign", agentId: agentId || null }),
    });
    if (res.ok) {
      toast.success(agentId ? "Lead reassigned (logged)" : "Assignment removed (logged)");
      onSaved?.();
    } else toast.error("Reassign failed");
    setBusy(false);
  }

  return (
    <div className="rounded-xl border bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wide text-slate-600"
      >
        <Pencil className="h-3 w-3" /> Edit & reassign (management)
        <span className="ml-auto text-[10px] font-medium normal-case text-muted-foreground">{open ? "hide" : "open"}</span>
      </button>

      {open ? (
        <div className="space-y-2 border-t p-3">
          {/* reassignment */}
          <div className="flex items-end gap-2 rounded-lg bg-slate-50 p-2">
            <div className="min-w-0 flex-1 space-y-1">
              <Label className="flex items-center gap-1">
                <UserCog className="h-3 w-3" /> Reassign to
              </Label>
              <NativeSelect value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
                <option value="">— Pool (remove assignment) —</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button size="sm" disabled={busy || !assignTo} onClick={() => void reassign(assignTo)}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Reassign"}
            </Button>
          </div>

          {/* field grid */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {EDITABLE.map((f) => (
              <div key={f.key} className="space-y-0.5">
                <Label className="text-[10px]">{f.label}</Label>
                <Input
                  value={draft[f.key] !== undefined ? draft[f.key] : val(f.key)}
                  inputMode={f.type === "num" ? "decimal" : "text"}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  className="h-8 text-xs"
                />
              </div>
            ))}
          </div>
          <Button size="sm" className="w-full" disabled={busy || Object.keys(changed).length === 0} onClick={() => void save()}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save {Object.keys(changed).length > 0 ? `${Object.keys(changed).length} change(s)` : "changes"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The lead_history timeline — rendered ONLY inside staff views. */
export function LeadHistoryTimeline({ entries }: { entries: HistoryEntry[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-3 text-center">
        <p className="flex items-center justify-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          <History className="h-3 w-3" /> Lead history
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">No field changes logged yet — edits and reassignments appear here.</p>
      </div>
    );
  }
  return (
    <div>
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        <History className="h-3 w-3" /> Lead history — visible to management only
      </p>
      <div className="max-h-56 space-y-1 overflow-y-auto pr-1 thin-scroll">
        {entries.map((h) => (
          <div key={h.id} className="rounded-lg border bg-slate-50 p-2 text-[11px]">
            <p className="flex flex-wrap items-center gap-1 font-semibold text-slate-700">
              {h.fieldName.replace(/_/g, " ")}
              <span className="font-mono text-[10px] font-normal text-rose-600 line-through decoration-rose-300">
                {(h.oldValue ?? "—").slice(0, 40)}
              </span>
              <span className="text-slate-400">→</span>
              <span className="font-mono text-[10px] font-normal text-emerald-700">{(h.newValue ?? "—").slice(0, 40)}</span>
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {h.changedByName ?? "system"} ({h.changedByRole ?? "—"}) · {dateTime(h.createdAt)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
