import type { Role } from "./auth";

export const LEAD_STATUSES = [
  "NEW",
  "IN_PROGRESS",
  "CALLBACK",
  "NO_RESPONSE",
  "REJECTED",
  "PAYMENT_APPROVAL",
  "CLOSED",
  "ARCHIVED",
  "LOST",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const AGENT_FILTERS = [
  { key: "IN_PROGRESS", label: "In Process", dot: "bg-blue-500" },
  { key: "CALLBACK", label: "Call back", dot: "bg-amber-500" },
  { key: "NO_RESPONSE", label: "No Response", dot: "bg-orange-500" },
  { key: "PAYMENT_APPROVAL", label: "Payment Approval", dot: "bg-violet-500" },
  { key: "REJECTED", label: "Reject / Not Interest", dot: "bg-rose-500" },
] as const;

/**
 * Pipedrive-style board order. UNASSIGNED is a virtual column (pool) and
 * CLOSED_WON is staff-only — it is never rendered on the agent primary view.
 */
export type PipelineStage = {
  key: string;
  label: string;
  staffOnly: boolean;
  virtual: boolean;
};

export const PIPELINE_STAGES: PipelineStage[] = [
  { key: "NEW", label: "New", staffOnly: false, virtual: false },
  { key: "IN_PROGRESS", label: "In Process", staffOnly: false, virtual: false },
  { key: "CALLBACK", label: "Call back", staffOnly: false, virtual: false },
  { key: "NO_RESPONSE", label: "No Response", staffOnly: false, virtual: false },
  { key: "REJECTED", label: "Reject / Not Interest", staffOnly: false, virtual: false },
  { key: "PAYMENT_APPROVAL", label: "Payment Approval", staffOnly: false, virtual: false },
  { key: "CLOSED", label: "Closed Won", staffOnly: true, virtual: false },
];

/**
 * Pipeline A — ASSIGNED LEADS (7 stages). Active work owned by an agent.
 * "New" = assigned today. Closed Won is management-only.
 */
export const ASSIGNED_STAGES: PipelineStage[] = PIPELINE_STAGES;

/**
 * Pipeline B — UNASSIGNED LEADS (3 stages, management view only).
 * Fresh pool plus auto-recycled leads that keep their status label.
 */
export const UNASSIGNED_STAGES: PipelineStage[] = [
  { key: "UNASSIGNED", label: "New in Pool", staffOnly: true, virtual: true },
  { key: "UNASSIGNED_NO_RESPONSE", label: "No Response", staffOnly: true, virtual: true },
  { key: "UNASSIGNED_REJECTED", label: "Reject / Not Interest", staffOnly: true, virtual: true },
];

/** Flat list of every status value used anywhere. */
export const ALL_STATUS_KEYS = [
  "NEW",
  "IN_PROGRESS",
  "CALLBACK",
  "NO_RESPONSE",
  "REJECTED",
  "PAYMENT_APPROVAL",
  "CLOSED",
  "LOST",
  "ARCHIVED",
] as const;

export const STAFF_ONLY_STAGES = ["CLOSED", "UNASSIGNED"];

export const STATUS_META: Record<string, { label: string; className: string; kanban: string }> = {
  NEW: {
    label: "New",
    className: "bg-slate-100 text-slate-700 border-slate-200",
    kanban: "bg-slate-50 border-slate-300",
  },
  UNASSIGNED: {
    label: "New in Pool",
    className: "bg-zinc-100 text-zinc-600 border-zinc-200",
    kanban: "bg-zinc-50 border-zinc-300",
  },
  IN_PROGRESS: {
    label: "In Process",
    className: "bg-blue-50 text-blue-700 border-blue-200",
    kanban: "bg-blue-50/60 border-blue-300",
  },
  NO_RESPONSE: {
    label: "No Response",
    className: "bg-orange-50 text-orange-700 border-orange-200",
    kanban: "bg-orange-50/60 border-orange-300",
  },
  UNASSIGNED_NO_RESPONSE: {
    label: "No Response",
    className: "bg-orange-50 text-orange-700 border-orange-200",
    kanban: "bg-orange-50/60 border-orange-300",
  },
  UNASSIGNED_REJECTED: {
    label: "Reject / Not Interest",
    className: "bg-rose-50 text-rose-700 border-rose-200",
    kanban: "bg-rose-50/60 border-rose-300",
  },
  LOST: {
    label: "Lost / Returned to Pool",
    className: "bg-stone-100 text-stone-600 border-stone-300",
    kanban: "bg-stone-50 border-stone-300",
  },
  CALLBACK: {
    label: "Callback",
    className: "bg-amber-50 text-amber-700 border-amber-200",
    kanban: "bg-amber-50/60 border-amber-300",
  },
  PAYMENT_APPROVAL: {
    label: "Payment Approval",
    className: "bg-violet-50 text-violet-700 border-violet-200",
    kanban: "bg-violet-50/60 border-violet-300",
  },
  REJECTED: {
    label: "Reject / Not Interest",
    className: "bg-rose-50 text-rose-700 border-rose-200",
    kanban: "bg-rose-50/60 border-rose-300",
  },
  CLOSED: {
    label: "Closed Won",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    kanban: "bg-emerald-50/60 border-emerald-300",
  },
  ARCHIVED: {
    label: "Archived",
    className: "bg-zinc-100 text-zinc-600 border-zinc-200",
    kanban: "bg-zinc-50 border-zinc-300",
  },
};

export type NavItem = {
  href: string;
  label: string;
  icon: string;
  roles: Role[];
  badge?: "approvals" | "requests" | "errors" | "tickets";
};

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "grid", roles: ["ADMIN", "HR", "MANAGER", "AGENT"] },
  { href: "/agent", label: "My Leads", icon: "phone", roles: ["AGENT"] },
  { href: "/agent/earnings", label: "Earnings", icon: "wallet", roles: ["AGENT"] },
  { href: "/agent/profile", label: "Profile & KYC", icon: "id-card", roles: ["AGENT"] },
  { href: "/pipeline", label: "Lead Pipeline", icon: "kanban", roles: ["ADMIN", "HR", "MANAGER"] },
  { href: "/approvals", label: "Approvals Center", icon: "badge-check", roles: ["ADMIN", "HR", "MANAGER"], badge: "approvals" },
  { href: "/lead-errors", label: "Lead Error Submissions", icon: "alert", roles: ["ADMIN", "HR", "MANAGER"], badge: "errors" },
  { href: "/tickets", label: "Support & Requests", icon: "ticket", roles: ["AGENT", "ADMIN", "HR", "MANAGER"], badge: "tickets" },
  { href: "/agents", label: "Agents & HR", icon: "users", roles: ["ADMIN", "HR", "MANAGER"] },
  { href: "/commission", label: "Commission & Bonus", icon: "award", roles: ["ADMIN", "HR", "MANAGER"] },
  { href: "/agent-slabs", label: "Agent Slabs & Quotas", icon: "sliders", roles: ["ADMIN", "HR", "MANAGER"] },
  { href: "/niches", label: "Niche Manager", icon: "tags", roles: ["ADMIN", "HR", "MANAGER"] },
  { href: "/broadcasts", label: "Banners & Popups", icon: "megaphone", roles: ["ADMIN", "HR", "MANAGER"] },
  { href: "/videos", label: "Video Studio", icon: "film", roles: ["ADMIN", "HR", "MANAGER"] },
  { href: "/files", label: "File Manager", icon: "folder", roles: ["ADMIN", "HR", "MANAGER"] },
  { href: "/settings", label: "Field Visibility", icon: "settings", roles: ["ADMIN", "HR", "MANAGER"] },
  { href: "/audit-logs", label: "Audit Trail", icon: "scroll", roles: ["ADMIN", "HR", "MANAGER"] },
  { href: "/automation", label: "Automation / Cron", icon: "timer", roles: ["ADMIN", "HR", "MANAGER"] },
];

export function navForRole(role: Role) {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

export const DEFAULT_PAGESIZE = 500;
export const MAX_PAGESIZE = 500;

export function landingRoute(role: Role | string) {
  return "/dashboard";
}
