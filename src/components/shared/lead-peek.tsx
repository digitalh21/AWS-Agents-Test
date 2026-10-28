"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { Sheet } from "@/components/ui/dialog";
import { LEAD_FIELDS } from "@/lib/fields";
import { LeadEditPanel, LeadHistoryTimeline, type HistoryEntry } from "@/components/staff/lead-inspect";
import { dateTime, inr } from "@/lib/utils";

type Lead = Record<string, unknown> & { id: number };

/**
 * Universal "Open Lead" viewer.
 * Works from Lead Errors, Tickets, Approvals, Audit History — anywhere a lead id
 * appears. Uses the staff endpoint when the viewer is staff, the agent endpoint
 * otherwise, so field-visibility rules still apply.
 */
export function LeadPeek({
  leadId,
  leadCode,
  title,
  isStaff,
  onClose,
}: {
  leadId: number | null;
  leadCode?: string | null;
  title?: string;
  isStaff: boolean;
  onClose: () => void;
}) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [logs, setLogs] = useState<Array<{ id: number; status: string; notes: string | null; createdAt: string; agentName: string | null }>>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (id: number) => {
    setLoading(true);
    const res = await fetch(isStaff ? `/api/leads/${id}` : `/api/agent/leads/${id}`);
    if (res.ok) {
      const json = (await res.json()) as { lead: Lead; logs?: typeof logs; myLogs?: typeof logs; history?: HistoryEntry[] };
      setLead(json.lead);
      setLogs(json.logs ?? json.myLogs ?? []);
      setHistory(json.history ?? []);
    }
    setLoading(false);
  }, [isStaff]);

  useEffect(() => {
    if (leadId) void load(leadId);
    else {
      setLead(null);
      setLogs([]);
      setHistory([]);
    }
  }, [leadId, load]);

  const str = (k: string) => {
    const v = lead?.[k];
    return v === null || v === undefined || v === "" ? "—" : String(v);
  };
  const hidden = (k: string) => Boolean(lead?.[`${k}__hidden`]);

  return (
    <Sheet
      open={Boolean(leadId)}
      onOpenChange={(v) => !v && onClose()}
      title={title ?? (lead ? str("business_name") : "Lead context")}
      description={leadCode ? `Lead ${leadCode}` : lead ? `Lead #${lead.id}` : "Loading lead context…"}
    >
      {loading ? (
        <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading lead…
        </p>
      ) : !lead ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Lead details are not available for your role.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline">{str("status").replace(/_/g, " ")}</Badge>
            <Badge variant="muted">{str("niche_category")}</Badge>
            {lead.dealAmount ? <Badge variant="success">{inr(lead.dealAmount as string)}</Badge> : null}
          </div>

          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {LEAD_FIELDS.filter((f) => !hidden(f.key)).map((f) => (
              <div key={f.key} className="min-w-0 rounded-lg bg-slate-50 p-2">
                <dt className="truncate text-[9px] uppercase tracking-wide text-muted-foreground">{f.short}</dt>
                <dd className="truncate text-xs font-medium">{str(f.key)}</dd>
              </div>
            ))}
          </dl>

          {logs.length ? (
            <div>
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Recent activity</p>
              <div className="space-y-1">
                {logs.slice(0, 8).map((l) => (
                  <div key={l.id} className="rounded-lg bg-slate-50 p-2 text-[11px]">
                    <p className="font-semibold">
                      {l.agentName ?? "Agent"} · {l.status.replace(/_/g, " ")}
                    </p>
                    <p className="text-muted-foreground">{l.notes ?? "—"} · {dateTime(l.createdAt)}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {isStaff ? (
            <div className="space-y-2">
              <LeadEditPanel leadId={lead.id} lead={lead} onSaved={() => void load(lead.id)} />
              <LeadHistoryTimeline entries={history} />
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => window.open(isStaff ? `/pipeline?view=table&lead=${lead.id}` : `/agent?lead=${lead.id}`, "_self")}>
              <ExternalLink className="h-4 w-4" /> Open full lead
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              <X className="h-4 w-4" /> Close
            </Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

/** Small inline button that opens the LeadPeek sheet. */
export function OpenLeadButton({
  leadId,
  leadCode,
  isStaff,
  label = "Open Lead",
  size = "xs",
}: {
  leadId: number;
  leadCode?: string | null;
  isStaff: boolean;
  label?: string;
  size?: "xs" | "sm";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant="outline" onClick={() => setOpen(true)}>
        <ExternalLink className={size === "xs" ? "h-3 w-3" : "h-4 w-4"} /> {label}
      </Button>
      <LeadPeek leadId={open ? leadId : null} leadCode={leadCode} isStaff={isStaff} onClose={() => setOpen(false)} />
    </>
  );
}
