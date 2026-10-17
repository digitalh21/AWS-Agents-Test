"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCcw, ScrollText, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, DesktopTable, Input, MobileList, NativeSelect, Stat } from "@/components/ui/field";
import { OpenLeadButton } from "@/components/shared/lead-peek";
import { dateTime, num, timeAgo } from "@/lib/utils";

type Log = {
  id: number;
  action: string;
  detail: string | null;
  meta: unknown;
  createdAt: string;
  leadId: number | null;
  businessName: string | null;
  actorId: number | null;
  actorName: string | null;
  actorRole: string | null;
};

export function AuditTrail() {
  const [rows, setRows] = useState<Log[]>([]);
  const [actions, setActions] = useState<Array<{ action: string; count: number }>>([]);
  const [summary, setSummary] = useState({ today: 0, total: 0 });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [action, setAction] = useState("ALL");
  const [leadId, setLeadId] = useState("");

  const load = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: "50" });
    if (action !== "ALL") params.set("action", action);
    if (leadId) params.set("leadId", leadId);
    const res = await fetch(`/api/audit-logs?${params.toString()}`);
    if (res.ok) {
      const json = (await res.json()) as {
        rows: Log[];
        actions: Array<{ action: string; count: number }>;
        summary: { today: number; total: number };
        totalPages: number;
      };
      setRows(json.rows);
      setActions(json.actions);
      setSummary(json.summary);
      setTotalPages(json.totalPages);
    }
  }, [page, action, leadId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3 p-3 sm:p-4 lg:p-6">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Events (24h)" value={num(summary.today)} tone="info" />
        <Stat label="Total events" value={num(summary.total)} />
        <Stat label="Action types" value={num(actions.length)} hint="status, uploads, edits" tone="success" />
      </div>

      <div className="space-y-2 rounded-xl border bg-white p-2 sm:p-3">
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-muted-foreground sm:left-2.5 sm:top-2.5 sm:h-4 sm:w-4" />
            <Input
              value={leadId}
              onChange={(e) => setLeadId(e.target.value)}
              placeholder="Filter by lead ID"
              className="pl-11 sm:pl-8"
              inputMode="numeric"
            />
          </div>
          <Button variant="outline" size="icon" className="h-11 w-11 shrink-0 sm:h-10 sm:w-10" onClick={() => void load()} aria-label="Refresh">
            <RefreshCcw className="h-4 w-4" />
          </Button>
        </div>
        <NativeSelect value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="ALL">All actions</option>
          {actions.map((a) => (
            <option key={a.action} value={a.action}>
              {a.action} ({num(a.count)})
            </option>
          ))}
        </NativeSelect>
      </div>

      <DesktopTable>
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="border-b bg-slate-50 text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="p-2">When</th>
              <th className="p-2">Actor</th>
              <th className="p-2">Action</th>
              <th className="p-2">Lead</th>
              <th className="p-2">Detail</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className="border-b last:border-0">
                <td className="whitespace-nowrap p-2 text-[10px] text-muted-foreground">
                  {timeAgo(l.createdAt)}
                  <span className="block">{dateTime(l.createdAt)}</span>
                </td>
                <td className="p-2">
                  {l.actorName ?? "System"}
                  <span className="block text-[10px] text-muted-foreground">
                    #{l.actorId ?? "—"} {l.actorRole ?? ""}
                  </span>
                </td>
                <td className="p-2 font-semibold">{l.action}</td>
                <td className="p-2 text-muted-foreground">
                  {l.leadId ? `#${l.leadId}` : "—"}
                  <span className="block text-[10px]">{l.businessName ?? ""}</span>
                </td>
                <td className="p-2">
                  {l.detail ?? "—"}
                  {l.leadId ? (
                    <span className="mt-1 block">
                      <OpenLeadButton leadId={l.leadId} leadCode={l.businessName} isStaff={true} label="Open Lead" />
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </DesktopTable>

      <MobileList>
        {rows.map((l) => (
          <div key={l.id} className="rounded-xl border bg-white p-3 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <Badge variant="muted" className="shrink-0">
                {l.action}
              </Badge>
              <span className="shrink-0 text-right text-[10px] text-muted-foreground">
                {timeAgo(l.createdAt)}
                <span className="block">{dateTime(l.createdAt)}</span>
              </span>
            </div>
            {l.detail ? <p className="mt-1.5 text-xs">{l.detail}</p> : null}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[10px] text-muted-foreground">
              <span className="font-semibold text-slate-600">
                {l.actorName ?? "System"} · {l.actorRole ?? "—"}
              </span>
              {l.leadId ? (
                <span className="block">
                  lead #{l.leadId} {l.businessName ? `· ${l.businessName}` : ""}
                </span>
              ) : null}
                {l.leadId ? (
                  <span className="mt-1.5 block">
                    <OpenLeadButton leadId={l.leadId} leadCode={l.businessName} isStaff={true} />
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        {rows.length === 0 ? <p className="py-6 text-center text-xs text-muted-foreground">No audit events found.</p> : null}
      </MobileList>

      <div className="flex items-center justify-between gap-2 rounded-xl border bg-white p-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          <ChevronLeft className="h-4 w-4" /> Prev
        </Button>
        <span className="flex-1 text-center text-xs text-muted-foreground">
          Page {page}/{num(totalPages)}
        </span>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
          Next <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <p className="flex items-center justify-center gap-1 pb-2 text-[10px] text-muted-foreground">
        <ScrollText className="h-3 w-3" /> Immutable audit trail — every status change, upload and edit is recorded with user + lead id.
      </p>
    </div>
  );
}
