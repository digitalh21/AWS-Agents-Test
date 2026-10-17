/**
 * Canonical registry of the 14 lead data fields.
 * Every API response and UI surface derives its columns from this list so the
 * Admin matrix stays the single source of truth.
 */

export type RoleKey = "ADMIN" | "HR" | "MANAGER" | "AGENT";
export type FieldMode = "VISIBLE" | "MASKED" | "HIDDEN";

export const ROLES: Array<{ key: RoleKey; label: string; short: string }> = [
  { key: "ADMIN", label: "Admin", short: "ADM" },
  { key: "HR", label: "HR", short: "HR" },
  { key: "MANAGER", label: "Manager", short: "MGR" },
  { key: "AGENT", label: "Telecaller Agent", short: "AGT" },
];

export type LeadField = {
  key: string;
  label: string;
  short: string;
  group: "Identity" | "Location" | "Google Signals" | "Contact" | "Web" | "Pipeline";
  description: string;
  /** How MASKED renders this field */
  mask: "phone" | "text" | "link";
  /** Defaults tuned for least privilege on the agent console */
  defaults: Record<RoleKey, FieldMode>;
  /** Sensible lock: ADMIN can never lose access to a field */
  adminLocked?: boolean;
};

export const LEAD_FIELDS: LeadField[] = [
  {
    key: "lead_code",
    label: "Lead Serial Number",
    short: "Lead #",
    group: "Identity",
    description: "Stable serial code shown on cards, tables and exports.",
    mask: "text",
    defaults: { ADMIN: "VISIBLE", HR: "VISIBLE", MANAGER: "VISIBLE", AGENT: "VISIBLE" },
  },
  {
    key: "city_keyword",
    label: "City Keyword",
    short: "City",
    group: "Location",
    description: "Locality keyword used for scrapping and search.",
    mask: "text",
    defaults: { ADMIN: "VISIBLE", HR: "VISIBLE", MANAGER: "VISIBLE", AGENT: "VISIBLE" },
  },
  {
    key: "gmap_link",
    label: "Google Maps URL",
    short: "Map Link",
    group: "Location",
    description: "Deep link to the Google Business Profile listing.",
    mask: "link",
    defaults: { ADMIN: "VISIBLE", HR: "VISIBLE", MANAGER: "VISIBLE", AGENT: "VISIBLE" },
  },
  {
    key: "business_name",
    label: "Business Title",
    short: "Business",
    group: "Identity",
    description: "Prospect business name — primary label on every card.",
    mask: "text",
    defaults: { ADMIN: "VISIBLE", HR: "VISIBLE", MANAGER: "VISIBLE", AGENT: "VISIBLE" },
  },
  {
    key: "rating",
    label: "Google Business Rating",
    short: "Rating",
    group: "Google Signals",
    description: "Star rating used for the audit pitch.",
    mask: "text",
    defaults: { ADMIN: "VISIBLE", HR: "VISIBLE", MANAGER: "VISIBLE", AGENT: "VISIBLE" },
  },
  {
    key: "reviews_count",
    label: "Reviews vs Competitor",
    short: "Reviews",
    group: "Google Signals",
    description: "Google review count compared against the competitor count.",
    mask: "text",
    defaults: { ADMIN: "VISIBLE", HR: "VISIBLE", MANAGER: "VISIBLE", AGENT: "VISIBLE" },
  },
  {
    key: "niche_category",
    label: "Niche / Category",
    short: "Niche",
    group: "Identity",
    description: "Vertical the lead belongs to (Real Estate, Dentists, …).",
    mask: "text",
    defaults: { ADMIN: "VISIBLE", HR: "VISIBLE", MANAGER: "VISIBLE", AGENT: "VISIBLE" },
  },
  {
    key: "opens_at",
    label: "Business Working Hours",
    short: "Opens At",
    group: "Location",
    description: "Opening hours — helps agents time the call.",
    mask: "text",
    defaults: { ADMIN: "VISIBLE", HR: "VISIBLE", MANAGER: "VISIBLE", AGENT: "HIDDEN" },
  },
  {
    key: "phone",
    label: "Mobile Phone Number",
    short: "Phone",
    group: "Contact",
    description: "Raw prospect number used for tel: and wa.me deep links.",
    mask: "phone",
    defaults: { ADMIN: "VISIBLE", HR: "VISIBLE", MANAGER: "MASKED", AGENT: "MASKED" },
  },
  {
    key: "phone_normalized",
    label: "Normalized Phone (E.164)",
    short: "Phone E.164",
    group: "Contact",
    description: "Dialer-safe normalized number (+91XXXXXXXXXX).",
    mask: "phone",
    defaults: { ADMIN: "VISIBLE", HR: "VISIBLE", MANAGER: "MASKED", AGENT: "MASKED" },
  },
  {
    key: "website_status",
    label: "Website Status",
    short: "Web Status",
    group: "Web",
    description: "Active / Broken / No Website signal.",
    mask: "text",
    defaults: { ADMIN: "VISIBLE", HR: "VISIBLE", MANAGER: "VISIBLE", AGENT: "HIDDEN" },
  },
  {
    key: "website_url",
    label: "Website URL",
    short: "Website",
    group: "Web",
    description: "Prospect website address.",
    mask: "link",
    defaults: { ADMIN: "VISIBLE", HR: "VISIBLE", MANAGER: "VISIBLE", AGENT: "VISIBLE" },
  },
  {
    key: "service_status",
    label: "Service Status",
    short: "Service",
    group: "Google Signals",
    description: "Verified / Unclaimed / Suspended business profile state.",
    mask: "text",
    defaults: { ADMIN: "VISIBLE", HR: "VISIBLE", MANAGER: "VISIBLE", AGENT: "HIDDEN" },
  },
  {
    key: "call_status",
    label: "Call Outcome Status",
    short: "Call Outcome",
    group: "Pipeline",
    description: "Outcome of the last dial (Connected, No Answer, Switched Off…).",
    mask: "text",
    defaults: { ADMIN: "VISIBLE", HR: "VISIBLE", MANAGER: "VISIBLE", AGENT: "VISIBLE" },
  },
  {
    key: "status",
    label: "Lead Pipeline Status",
    short: "Pipeline",
    group: "Pipeline",
    description: "Kanban stage — NEW, IN_PROGRESS, CALLBACK, REJECTED…",
    mask: "text",
    defaults: { ADMIN: "VISIBLE", HR: "VISIBLE", MANAGER: "VISIBLE", AGENT: "VISIBLE" },
    adminLocked: true,
  },
];

export const FIELD_KEYS = LEAD_FIELDS.map((f) => f.key);

/** Legacy / alternate names that resolve to a canonical field key. */
export const FIELD_ALIASES: Record<string, string> = {
  niche_category: "niche_category",
  category_name: "niche_category",
  nicheId: "niche_category",
  niche_name: "niche_category",
  city: "city_keyword",
  phone_normalized: "phone_normalized",
  status: "status",
};

export function canonicalFieldKey(key: string) {
  return FIELD_ALIASES[key] ?? key;
}

export function fieldByKey(key: string) {
  return LEAD_FIELDS.find((f) => f.key === key);
}

export const FIELD_GROUPS = Array.from(new Set(LEAD_FIELDS.map((f) => f.group)));

export const MODE_META: Record<FieldMode, { label: string; className: string; dot: string }> = {
  VISIBLE: { label: "Visible", className: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  MASKED: { label: "Masked", className: "border-amber-200 bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  HIDDEN: { label: "Hidden", className: "border-slate-200 bg-slate-100 text-slate-600", dot: "bg-slate-400" },
};
