/**
 * DATABASE_URL hardening.
 *
 * Secrets sourced from dashboards/panels frequently arrive with an
 * UN-encoded password (raw '#' or '%' in the userinfo) — which breaks URL
 * parsing and kills the pg driver with opaque errors. Everything is
 * normalized here at connection time instead of trusting the env string.
 *
 * Percent-encoding rules applied:  # -> %23    % -> %25    @ -> %40
 * (full RFC-3986 userinfo encoding, idempotent for already-encoded values).
 */

/** Known-bad pooler host typos -> verified-good equivalent. */
const POOLER_HOST_FIXES: Record<string, string> = {
  // This project's Supabase tenant was verified live on the Singapore pooler;
  // the "ap-south-1" variant is a paste typo that Supabase answers with
  // "tenant/user not found".
  "aws-0-ap-south-1.pooler.supabase.com": "aws-0-ap-southeast-1.pooler.supabase.com",
};

/** Decode any valid %XX sequences (survives stray %), then re-encode fully. */
function normalizeSecretComponent(value: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // partially-encoded value (e.g. "T%Kze…#"): unescape only valid %XX pairs
    decoded = value.replace(/%([0-9A-Fa-f]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
  }
  return encodeURIComponent(decoded);
}

/**
 * Returns a DATABASE_URL guaranteed to be parseable:
 *  - trims stray whitespace/newlines from the paste
 *  - percent-encodes the user (rare) and password userinfo components
 *  - rewrites known-bad Supabase pooler hosts (see POOLER_HOST_FIXES)
 * Returns the input unchanged when it is empty or unrecognisable.
 */
export function sanitizeDatabaseUrl(raw: string | undefined | null): string {
  const s = (raw ?? "").trim();
  if (!s) return s;

  const lower = s.toLowerCase();
  const schemeIdx = lower.startsWith("postgresql://")
    ? "postgresql://".length
    : lower.startsWith("postgres://")
      ? "postgres://".length
      : lower.startsWith("postgresql+")
        ? s.indexOf("://") + 3
        : -1;
  if (schemeIdx < 3) return s;

  const scheme = s.slice(0, schemeIdx);
  const afterScheme = s.slice(schemeIdx);
  const slashIdx = afterScheme.indexOf("/");
  const userHost = slashIdx === -1 ? afterScheme : afterScheme.slice(0, slashIdx);
  const path = slashIdx === -1 ? "/postgres" : afterScheme.slice(slashIdx);

  const at = userHost.lastIndexOf("@");
  if (at === -1) return s;
  const userinfo = userHost.slice(0, at);
  let hostport = userHost.slice(at + 1);

  const colon = userinfo.indexOf(":");
  const user = colon === -1 ? userinfo : userinfo.slice(0, colon);
  const pass = colon === -1 ? "" : userinfo.slice(colon + 1);

  const encUser = user ? normalizeSecretComponent(user) : user;
  const encPass = pass ? normalizeSecretComponent(pass) : pass;

  const hostOnly = hostport.split(":")[0] ?? hostport;
  if (POOLER_HOST_FIXES[hostOnly]) {
    hostport = hostport.replace(hostOnly, POOLER_HOST_FIXES[hostOnly]!);
  }

  const creds = encPass ? `${encUser}:${encPass}` : encUser;
  return `${scheme}${creds}@${hostport}${path}`;
}

/** Parsed, sanitized target info for health reporting (never throws). */
export function describeDatabaseUrl(raw: string | undefined | null) {
  const s = sanitizeDatabaseUrl(raw);
  try {
    const u = new URL(s);
    const host = u.hostname;
    const isSupabase = /supabase\.(co|com|net)$/i.test(host) || /pooler.*supabase/i.test(host);
    return { host, isSupabase, database: u.pathname.replace(/^\//, ""), valid: true };
  } catch {
    return { host: "unconfigured", isSupabase: false, database: "", valid: false };
  }
}
