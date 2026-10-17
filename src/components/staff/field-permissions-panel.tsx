"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { History as HistoryIcon, Check, Eye, EyeOff, Loader2, RotateCcw, Save, ShieldCheck, Table2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, SectionCard, Stat } from "@/components/ui/field";
import { Sheet } from "@/components/ui/dialog";
import { LEAD_FIELDS, MODE_META, ROLES, type FieldMode } from "@/lib/fields";
import { cn } from "@/lib/utils";

type Policy = Record<string, Record<string, FieldMode>>;

const MODES: FieldMode[] = ["VISIBLE", "MASKED", "HIDDEN"];
const MODE_ICON: Record<FieldMode, typeof Eye> = { VISIBLE: Eye, MASKED: EyeOff, HIDDEN: EyeOff };

export function FieldPermissionsPanel({
  initialPolicy,
  viewerRole: initialViewerRole = "ADMIN",
  canEdit: initialCanEdit = false,
}: {
  initialPolicy?: Policy;
  viewerRole?: string;
  canEdit?: boolean;
}) {
  const [policy, setPolicy] = useState<Policy>(initialPolicy ?? {});
  const [draft, setDraft] = useState<Policy>(initialPolicy ?? {});
  const [loading, setLoading] = useState(!initialPolicy);
  const [saving, setSaving] = useState(false);
  const [canEdit, setCanEdit] = useState(initialCanEdit);
  const [viewerRole, setViewerRole] = useState(initialViewerRole);
  const [detailField, setDetailField] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(true);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [previewRole, setPreviewRole] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/settings/field-permissions");
    if (res.ok) {
      const json = (await res.json()) as {
        policy: Policy;
        viewer: { role: string; canEdit: boolean };
      };
      setPolicy(json.policy);
      setDraft(json.policy);
      setCanEdit(json.viewer.canEdit);
      setViewerRole(json.viewer.role);
    }
    const sys = await fetch("/api/settings/system");
    if (sys.ok) {
      const sj = (await sys.json()) as { settings: Record<string, string> };
      setShowHistory(sj.settings.show_history_to_agent !== "false");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(
    () => JSON.stringify(policy) !== JSON.stringify(draft),
    [policy, draft],
  );

  const changedCount = useMemo(() => {
    let n = 0;
    for (const field of LEAD_FIELDS) {
      for (const role of ROLES) {
        if ((draft[field.key]?.[role.key] ?? "VISIBLE") !== (policy[field.key]?.[role.key] ?? "VISIBLE")) n += 1;
      }
    }
    return n;
  }, [policy, draft]);

  function setMode(fieldKey: string, role: string, mode: FieldMode) {
    if (!canEdit) return;
    const field = LEAD_FIELDS.find((f) => f.key === fieldKey);
    if (field?.adminLocked && role === "ADMIN" && mode === "HIDDEN") {
      toast.error(`${field.label} cannot be hidden from ADMIN (pipeline integrity)`);
      return;
    }
    setDraft((prev) => ({ ...prev, [fieldKey]: { ...(prev[fieldKey] ?? {}), [role]: mode } }));
  }

  async function save() {
    const changes: Array<{ fieldKey: string; role: string; mode: FieldMode }> = [];
    for (const field of LEAD_FIELDS) {
      for (const role of ROLES) {
        const before = policy[field.key]?.[role.key] ?? "VISIBLE";
        const after = draft[field.key]?.[role.key] ?? "VISIBLE";
        if (before !== after) changes.push({ fieldKey: field.key, role: role.key, mode: after });
      }
    }
    if (changes.length === 0) return;
    setSaving(true);
    const res = await fetch("/api/settings/field-permissions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ changes }),
    });
    const json = (await res.json()) as { updated?: number; error?: string; policy?: Policy };
    if (res.ok) {
      toast.success(`${json.updated} field rule(s) saved — live across all dashboards`);
      setPolicy((json.policy as Policy) ?? draft);
      await load();
    } else toast.error(json.error ?? "Save failed");
    setSaving(false);
  }

  async function resetAll() {
    setSaving(true);
    const res = await fetch("/api/settings/field-permissions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reset: true }),
    });
    if (res.ok) {
      toast.success("Reset to default visibility");
      await load();
    } else toast.error("Reset failed");
    setSaving(false);
  }

  function applyColumn(role: string, mode: FieldMode) {
    if (!canEdit) return;
    setDraft((prev) => {
      const next: Policy = { ...prev };
      for (const field of LEAD_FIELDS) {
        if (field.adminLocked && role === "ADMIN" && mode === "HIDDEN") continue;
        next[field.key] = { ...(next[field.key] ?? {}), [role]: mode };
      }
      return next;
    });
  }

  function applyRow(fieldKey: string, mode: FieldMode) {
    if (!canEdit) return;
    const field = LEAD_FIELDS.find((f) => f.key === fieldKey);
    setDraft((prev) => {
      const next: Policy = { ...prev };
      for (const role of ROLES) {
        if (field?.adminLocked && role.key === "ADMIN" && mode === "HIDDEN") continue;
        next[fieldKey] = { ...(next[fieldKey] ?? {}), [role.key]: mode };
      }
      return next;
    });
  }

  if (loading && Object.keys(policy).length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading field visibility matrix…
      </div>
    );
  }

  const mode: string = previewRole ?? viewerRole;

  return (
    <div className="space-y-3 p-3 sm:p-4 lg:p-6">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Fields governed" value={LEAD_FIELDS.length} hint="× 4 roles = 56 rules" />
        <Stat
          label="Masked rules"
          value={ROLES.reduce((s, r) => s + Object.values(draft).filter((m) => m[r.key] === "MASKED").length, 0)}
          tone="warn"
          hint="partially obfuscated"
        />
        <Stat
          label="Hidden rules"
          value={ROLES.reduce((s, r) => s + Object.values(draft).filter((m) => m[r.key] === "HIDDEN").length, 0)}
          tone="danger"
          hint="not rendered at all"
        />
      </div>

      {!canEdit ? (
        <p className="flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          <ShieldCheck className="h-4 w-4 shrink-0" /> You are signed in as {viewerRole} — the matrix is read-only. Only ADMIN and HR can change
          field visibility.
        </p>
      ) : null}

      {/* ---------- history visibility toggle ---------- */}
      <SectionCard title="Agent Audit History" icon={<HistoryIcon className="h-3.5 w-3.5" />}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{showHistory ? "Show History to Agent" : "Hide History to Agent"}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {showHistory
                ? "Agents can read past call notes (previous agents always shown anonymously)."
                : "Agents see the masked banner and must use “Request History Access”; HR/Admin approve in the Approvals Center."}
            </p>
          </div>
          <button
            role="switch"
            aria-checked={showHistory}
            disabled={historyBusy || !canEdit}
            onClick={async () => {
              const next = !showHistory;
              setHistoryBusy(true);
              const res = await fetch("/api/settings/system", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ key: "show_history_to_agent", value: String(next) }),
              });
              if (res.ok) {
                setShowHistory(next);
                toast.success(next ? "History visible to agents" : "History hidden from agents");
              } else toast.error("Could not update setting");
              setHistoryBusy(false);
            }}
            className={cn(
              "relative h-8 w-14 shrink-0 rounded-full transition disabled:opacity-50",
              showHistory ? "bg-emerald-500" : "bg-slate-300",
            )}
          >
            <span
              className={cn(
                "absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all",
                showHistory ? "left-7" : "left-1",
              )}
            />
          </button>
        </div>
      </SectionCard>

      {/* ---------- desktop matrix ---------- */}
      <SectionCard
        title="Role Field Visibility Matrix"
        icon={<Table2 className="h-3.5 w-3.5" />}
        className="hidden lg:block"
      >
        <div className="overflow-x-auto thin-scroll">
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead className="border-b text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="p-2">Field</th>
                {ROLES.map((r) => (
                  <th key={r.key} className="p-2 text-center">
                    <p className="font-semibold text-slate-700">{r.label}</p>
                    <div className="mt-1 flex justify-center gap-0.5">
                      {MODES.map((m) => (
                        <button
                          key={m}
                          title={`Set all ${r.label} fields to ${m}`}
                          onClick={() => applyColumn(r.key, m)}
                          className="rounded border border-slate-200 px-1 py-0.5 text-[8px] font-bold hover:bg-slate-50"
                        >
                          {m[0]}
                        </button>
                      ))}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LEAD_FIELDS.map((field) => (
                <tr key={field.key} className="border-b last:border-0 hover:bg-slate-50">
                  <td className="p-2">
                    <button className="text-left" onClick={() => setDetailField(field.key)}>
                      <p className="font-semibold text-slate-800">{field.label}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">{field.key}</p>
                    </button>
                  </td>
                  {ROLES.map((r) => {
                    const value = draft[field.key]?.[r.key] ?? "VISIBLE";
                    const ActiveIcon = MODE_ICON[value];
                    return (
                      <td key={r.key} className="p-2 text-center">
                        <div className="inline-flex overflow-hidden rounded-lg border">
                          {MODES.map((m) => (
                            <button
                              key={m}
                              onClick={() => setMode(field.key, r.key, m)}
                              disabled={!canEdit}
                              title={m}
                              className={cn(
                                "px-2 py-1 text-[9px] font-bold transition",
                                value === m ? cn(MODE_META[m].className, "border-0") : "bg-white text-slate-400 hover:bg-slate-50",
                              )}
                            >
                              {value === m ? <ActiveIcon className="h-3 w-3" /> : m[0]}
                            </button>
                          ))}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[10px] text-muted-foreground">
          V = Visible · M = Masked · H = Hidden. Column headers bulk-set every field for that role; locked fields (pipeline status) cannot be
          hidden from ADMIN.
        </p>
      </SectionCard>

      {/* ---------- mobile cards ---------- */}
      <div className="space-y-2 lg:hidden">
        {LEAD_FIELDS.map((field) => (
          <div key={field.key} className="rounded-xl border bg-white p-3 shadow-sm">
            <button className="w-full text-left" onClick={() => setDetailField(field.key)}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{field.label}</p>
                  <p className="truncate font-mono text-[10px] text-muted-foreground">{field.key}</p>
                </div>
                <Badge variant="outline" className="shrink-0">
                  {field.group}
                </Badge>
              </div>
            </button>
            <div className="mt-2 space-y-1.5">
              {ROLES.map((r) => {
                const value = draft[field.key]?.[r.key] ?? "VISIBLE";
                const RowIcon = MODE_ICON[value];
                return (
                  <div key={r.key} className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{r.short}</span>
                    <div className="flex flex-1 overflow-hidden rounded-lg border">
                      {MODES.map((m) => (
                        <button
                          key={m}
                          onClick={() => setMode(field.key, r.key, m)}
                          disabled={!canEdit}
                          className={cn(
                            "flex flex-1 items-center justify-center gap-1 py-2 text-[10px] font-bold transition",
                            value === m ? MODE_META[m].className : "bg-white text-slate-400",
                          )}
                        >
                          {value === m ? <RowIcon className="h-3 w-3" /> : null}
                          {m[0]}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* ---------- live preview ---------- */}
      <SectionCard
        title="Preview as role"
        icon={<Eye className="h-3.5 w-3.5" />}
      >
        <div className="flex flex-wrap gap-1.5">
          {ROLES.map((r) => (
            <button
              key={r.key}
              onClick={() => setPreviewRole(r.key)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                mode === r.key ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="mt-3 space-y-1.5">
          {LEAD_FIELDS.map((field) => {
            const value: FieldMode = draft[field.key]?.[mode] ?? "VISIBLE";
            return (
              <div key={field.key} className="flex items-center gap-2 rounded-lg border p-2">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", MODE_META[value].dot)} />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{field.label}</span>
                <Badge className={cn("shrink-0 border", MODE_META[value].className)}>{MODE_META[value].label}</Badge>
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* ---------- sticky save bar ---------- */}
      <div className="sticky bottom-16 z-30 flex flex-wrap items-center gap-2 rounded-xl border bg-white/95 p-2 shadow-lg backdrop-blur lg:bottom-4">
        <p className="min-w-0 flex-1 text-[11px] text-muted-foreground">
          {dirty ? (
            <span className="font-semibold text-blue-700">{changedCount} unsaved change(s)</span>
          ) : (
            "All changes saved · rules apply instantly to every dashboard"
          )}
        </p>
        <Button variant="outline" size="sm" className="flex-1 sm:flex-none" onClick={() => void resetAll()} disabled={saving || !canEdit}>
          <RotateCcw className="h-4 w-4" /> Reset
        </Button>
        <Button size="sm" className="flex-1 sm:flex-none" onClick={() => void save()} disabled={saving || !dirty || !canEdit}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save rules
        </Button>
      </div>

      {/* field detail sheet */}
      <Sheet
        open={Boolean(detailField)}
        onOpenChange={(v) => !v && setDetailField(null)}
        title={LEAD_FIELDS.find((f) => f.key === detailField)?.label ?? "Field"}
        description={LEAD_FIELDS.find((f) => f.key === detailField)?.key}
      >
        {(() => {
          const field = LEAD_FIELDS.find((f) => f.key === detailField);
          if (!field) return <EmptyState title="Unknown field" />;
          return (
            <div className="space-y-3">
              <p className="rounded-lg bg-slate-50 p-2 text-xs text-muted-foreground">{field.description}</p>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline">{field.group}</Badge>
                <Badge variant="muted">mask: {field.mask}</Badge>
                {field.adminLocked ? <Badge variant="warn">admin-locked</Badge> : null}
              </div>
              <div className="space-y-2">
                {ROLES.map((r) => {
                  const value = draft[field.key]?.[r.key] ?? "VISIBLE";
                  const ActiveIcon = MODE_ICON[value];
                  return (
                    <div key={r.key} className="rounded-xl border p-2">
                      <p className="text-xs font-semibold">{r.label}</p>
                      <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                        {MODES.map((m) => (
                          <button
                            key={m}
                            onClick={() => setMode(field.key, r.key, m)}
                            disabled={!canEdit}
                            className={cn(
                              "flex items-center justify-center gap-1 rounded-lg border py-2 text-[10px] font-bold transition",
                              value === m ? MODE_META[m].className : "bg-white text-slate-500",
                            )}
                          >
                            {value === m ? <Check className="h-3 w-3" /> : null}
                            {MODE_META[m].label}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </Sheet>
    </div>
  );
}
