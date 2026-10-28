import { sql } from "drizzle-orm";
import { db } from "@/db";
import { ensureTables } from "@/db/bootstrap";

export const SETTING_KEYS = {
  showHistoryToAgent: "show_history_to_agent",
} as const;

type Defaults = Record<string, string>;

const DEFAULTS: Defaults = {
  [SETTING_KEYS.showHistoryToAgent]: "true",
};

let cache: { values: Defaults; at: number } | null = null;
const TTL_MS = 5_000;

export function invalidateSettings() {
  cache = null;
}

export async function getSettings(): Promise<Defaults> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.values;
  const values: Defaults = { ...DEFAULTS };
  try {
    const rows = await db.execute<{ key: string; value: string }>(
      sql`select key, value from system_settings`,
    );
    for (const row of rows.rows) values[row.key] = row.value;
  } catch {
    // table not provisioned yet
  }
  cache = { values, at: Date.now() };
  return values;
}

export async function getSetting(key: string): Promise<string> {
  const all = await getSettings();
  return all[key] ?? DEFAULTS[key] ?? "";
}

export async function getBoolSetting(key: string): Promise<boolean> {
  return (await getSetting(key)) === "true";
}

/** Agents may see past-agent audit history only when this is enabled. */
export async function agentHistoryVisible(): Promise<boolean> {
  return getBoolSetting(SETTING_KEYS.showHistoryToAgent);
}

export async function setSetting(key: string, value: string, updatedBy: string) {
  await ensureTables();
  await db.execute(sql`
    insert into system_settings (key, value, updated_by, updated_at)
    values (${key}, ${value}, ${updatedBy}, now())
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()
  `);
  invalidateSettings();
}
