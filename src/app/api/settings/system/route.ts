import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { audit, fail, handleError, ok } from "@/lib/api";
import { requireStaff } from "@/lib/auth";
import { SETTING_KEYS, getSettings, setSetting } from "@/lib/settings";
import { ensureTables } from "@/db/bootstrap";

export const dynamic = "force-dynamic";

const ALLOWED: Record<string, (v: string) => boolean> = {
  [SETTING_KEYS.showHistoryToAgent]: (v) => v === "true" || v === "false",
};

export async function GET() {
  try {
    await ensureTables();
    const staff = await requireStaff();
    const values = await getSettings();

    const history = await db
      .select({
        id: users.id,
        name: users.name,
        role: users.role,
        updatedAt: sql<string>`to_char(${users.lastSeenAt}, 'YYYY-MM-DD')`,
      })
      .from(users)
      .where(eq(users.role, "AGENT"))
      .orderBy(desc(users.lastSeenAt))
      .limit(1);

    return ok({
      settings: values,
      viewer: { id: staff.id, role: staff.role, canEdit: staff.role === "ADMIN" || staff.role === "HR" },
      meta: {
        [SETTING_KEYS.showHistoryToAgent]: {
          label: "Show History to Agent",
          description:
            "When off, agents see the masked banner 'Audit history · previous agents (anonymous)' and must request access.",
          lastTouchedLead: history[0]?.updatedAt ?? null,
        },
      },
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await ensureTables();
    const staff = await requireStaff();
    if (staff.role !== "ADMIN" && staff.role !== "HR") {
      return fail("Only ADMIN or HR can change system settings", 403);
    }
    const body = (await request.json()) as { key?: string; value?: string };
    const key = String(body.key ?? "");
    const value = String(body.value ?? "");

    if (!ALLOWED[key]) return fail("Unknown or unsupported setting", 422);
    if (!ALLOWED[key](value)) return fail("Invalid value", 422);

    await setSetting(key, value, staff.id);
    await audit({
      actorId: staff.id,
      actorRole: staff.role,
      action: "SETTING_UPDATED",
      detail: `${key} = ${value}`,
    });

    return ok({ key, value, settings: await getSettings() });
  } catch (error) {
    return handleError(error);
  }
}
