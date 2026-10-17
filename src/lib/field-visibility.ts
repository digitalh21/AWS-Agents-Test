import { sql } from "drizzle-orm";
import { db } from "@/db";
import { LEAD_FIELDS, canonicalFieldKey, type FieldMode, type RoleKey } from "@/lib/fields";

export type FieldPolicy = Record<string, Record<string, FieldMode>>;

let cache: { policy: FieldPolicy; at: number } | null = null;
const TTL_MS = 10_000;

/** Default policy derived from the field registry. */
export function defaultPolicy(): FieldPolicy {
  const policy: FieldPolicy = {};
  for (const field of LEAD_FIELDS) {
    policy[field.key] = { ...(field.defaults as Record<RoleKey, FieldMode>) };
  }
  return policy;
}

export function invalidateFieldPolicy() {
  cache = null;
}

/** Loads the admin-configured matrix (10s cache) merged over defaults. */
export async function getFieldPolicy(): Promise<FieldPolicy> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.policy;
  const policy = defaultPolicy();
  try {
    const rows = await db.execute<{ field_key: string; role: string; mode: string }>(
      sql`select field_key, role, mode from field_permissions`,
    );
    for (const row of rows.rows) {
      const mode = String(row.mode).toUpperCase() as FieldMode;
      if (!["VISIBLE", "MASKED", "HIDDEN"].includes(mode)) continue;
      policy[row.field_key] = { ...(policy[row.field_key] ?? {}), [row.role]: mode };
    }
  } catch {
    // table not provisioned yet — fall back to defaults
  }
  cache = { policy, at: Date.now() };
  return policy;
}

/** Resolves the effective mode for a role, defaulting to the registry default. */
export function modeFor(policy: FieldPolicy, fieldKey: string, role: string): FieldMode {
  const canonical = canonicalFieldKey(fieldKey);
  const entry = policy[canonical];
  const mode = entry?.[role];
  if (mode) return mode;
  const field = LEAD_FIELDS.find((f) => f.key === canonical);
  return (field?.defaults[role as RoleKey] ?? "VISIBLE") as FieldMode;
}

/* ------------------------------ masking ------------------------------ */

export function maskPhone(value: string | null | undefined) {
  const digits = (value ?? "").replace(/[^0-9+]/g, "");
  if (!digits) return "••••••••";
  const tail = digits.slice(-2);
  const head = digits.slice(0, Math.min(3, digits.length));
  const hidden = Math.max(3, digits.length - head.length - tail.length);
  return `${head}${"•".repeat(hidden)}${tail}`;
}

export function maskText(value: string | null | undefined) {
  const text = (value ?? "").toString().trim();
  if (!text) return "••••••";
  if (text.length <= 3) return "•".repeat(text.length);
  if (text.length <= 8) return `${text.slice(0, 1)}${"•".repeat(text.length - 2)}${text.slice(-1)}`;
  return `${text.slice(0, 3)}${"•".repeat(Math.min(6, text.length - 5))}${text.slice(-2)}`;
}

export function maskLink(value: string | null | undefined) {
  const text = (value ?? "").toString().trim();
  if (!text) return "••••••";
  try {
    const host = new URL(text.startsWith("http") ? text : `https://${text}`).hostname;
    return `${host.slice(0, 6)}•••/${"•".repeat(4)}`;
  } catch {
    return maskText(text);
  }
}

/** Maps a lead row into the field keys exposed by the visibility engine. */
export function projectLead(lead: Record<string, unknown>) {
  return {
    lead_code: lead.leadCode ?? (lead.id ? `LC-${String(lead.id).padStart(7, "0")}` : null),
    city_keyword: lead.cityKeyword ?? lead.city ?? null,
    gmap_link: lead.gmapLink ?? null,
    business_name: lead.businessName ?? null,
    rating: lead.rating ?? null,
    reviews_count: lead.reviewsCount ?? null,
    competitor_reviews: lead.competitorReviews ?? null,
    competitor_name: lead.competitorName ?? null,
    niche_category: lead.nicheCategory ?? lead.categoryName ?? lead.nicheName ?? null,
    opens_at: lead.opensAt ?? null,
    phone: lead.phone ?? null,
    phone_normalized: lead.phoneNormalized ?? null,
    website_status: lead.websiteStatus ?? null,
    website_url: lead.websiteUrl ?? lead.website ?? null,
    service_status: lead.serviceStatus ?? null,
    call_status: lead.callStatus ?? null,
    status: lead.status ?? null,
  } as Record<string, unknown>;
}

/**
 * Applies the admin visibility matrix to a single projected lead.
 * HIDDEN keys are removed, MASKED keys are obfuscated in place.
 */
export function applyFieldPolicy<T extends Record<string, unknown>>(
  projected: T,
  policy: FieldPolicy,
  role: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [rawKey, rawValue] of Object.entries(projected)) {
    const key = rawKey.endsWith("__hidden") || rawKey.endsWith("__masked") ? rawKey : canonicalFieldKey(rawKey);
    if (Object.prototype.hasOwnProperty.call(out, key)) continue;
    const mode = modeFor(policy, key, role);
    if (mode === "HIDDEN") {
      out[key] = null;
      out[`${key}__hidden`] = true;
      continue;
    }
    if (mode === "MASKED") {
      const value = (rawValue ?? "") as string;
      out[key] =
        key.startsWith("phone")
          ? maskPhone(value)
          : key === "gmap_link" || key === "website_url"
            ? maskLink(value)
            : maskText(value);
      out[`${key}__masked`] = true;
      continue;
    }
    out[key] = rawValue;
  }
  return out;
}

/** Convenience: project + apply in one call. */
export function applyToLead(lead: Record<string, unknown>, policy: FieldPolicy, role: string) {
  return applyFieldPolicy(projectLead(lead), policy, role);
}

/** Server-side helper: does this role still get the raw phone for dialing? */
export function canSeeRawPhone(policy: FieldPolicy, role: string) {
  return modeFor(policy, "phone", role) === "VISIBLE";
}
