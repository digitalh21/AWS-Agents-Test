import { sql } from "drizzle-orm";
import { db } from "@/db";
import { audit, fail, handleError, ok } from "@/lib/api";
import { requireStaff } from "@/lib/auth";
import { FIELD_KEYS, LEAD_FIELDS, ROLES, type FieldMode, type RoleKey } from "@/lib/fields";
import { defaultPolicy, getFieldPolicy, invalidateFieldPolicy } from "@/lib/field-visibility";
import { ensureTables } from "@/db/bootstrap";

export const dynamic = "force-dynamic";

const VALID: FieldMode[] = ["VISIBLE", "MASKED", "HIDDEN"];

export async function GET() {
  try {
    await ensureTables();
    const staff = await requireStaff();
    const policy = await getFieldPolicy();

    const counts = await db.execute<{ visible: string; masked: string; hidden: string }>(sql`
      select
        count(*) filter (where mode = 'VISIBLE')::text as visible,
        count(*) filter (where mode = 'MASKED')::text as masked,
        count(*) filter (where mode = 'HIDDEN')::text as hidden
      from field_permissions
    `);

    return ok({
      fields: LEAD_FIELDS,
      roles: ROLES,
      policy,
      overrides: Number(counts.rows[0]?.visible ?? 0) + Number(counts.rows[0]?.masked ?? 0) + Number(counts.rows[0]?.hidden ?? 0),
      summary: {
        visible: Number(counts.rows[0]?.visible ?? 0),
        masked: Number(counts.rows[0]?.masked ?? 0),
        hidden: Number(counts.rows[0]?.hidden ?? 0),
      },
      viewer: { id: staff.id, role: staff.role, canEdit: staff.role === "ADMIN" || staff.role === "HR" },
    });
  } catch (error) {
    return handleError(error);
  }
}

/** Upsert one or many field/role modes. ADMIN + HR may configure. */
export async function PATCH(request: Request) {
  try {
    await ensureTables();
    const staff = await requireStaff();
    if (staff.role !== "ADMIN" && staff.role !== "HR") {
      return fail("Only ADMIN or HR can change field visibility", 403);
    }

    const body = (await request.json()) as {
      changes?: Array<{ fieldKey?: string; role?: string; mode?: string }>;
      fieldKey?: string;
      role?: string;
      mode?: string;
      reset?: boolean;
    };

    if (body.reset) {
      await db.execute(sql`delete from field_permissions`);
      invalidateFieldPolicy();
      await audit({
        actorId: staff.id,
        actorRole: staff.role,
        action: "FIELD_PERMISSIONS_RESET",
        detail: "All field visibility overrides cleared (back to defaults)",
      });
      return ok({ updated: 0, reset: true, policy: defaultPolicy() });
    }

    const changes = body.changes ?? [{ fieldKey: body.fieldKey, role: body.role, mode: body.mode }];
    let updated = 0;

    for (const change of changes) {
      const fieldKey = String(change.fieldKey ?? "");
      const role = String(change.role ?? "").toUpperCase() as RoleKey;
      const mode = String(change.mode ?? "").toUpperCase() as FieldMode;

      if (!FIELD_KEYS.includes(fieldKey)) return fail(`Unknown field: ${fieldKey}`, 422);
      if (!ROLES.some((r) => r.key === role)) return fail(`Unknown role: ${role}`, 422);
      if (!VALID.includes(mode)) return fail(`mode must be VISIBLE | MASKED | HIDDEN`, 422);

      // ADMIN always retains access to locked fields (pipeline status, business name)
      const field = LEAD_FIELDS.find((f) => f.key === fieldKey);
      if (field?.adminLocked && role === "ADMIN" && mode === "HIDDEN") {
        return fail(`${field.label} cannot be hidden from ADMIN (pipeline integrity)`, 409);
      }

      await db.execute(sql`
        insert into field_permissions (field_key, role, mode, updated_by, updated_at)
        values (${fieldKey}, ${role}, ${mode}, ${staff.id}, now())
        on conflict (field_key, role) do update
          set mode = excluded.mode, updated_by = excluded.updated_by, updated_at = now()
      `);
      updated += 1;
    }

    invalidateFieldPolicy();
    await audit({
      actorId: staff.id,
      actorRole: staff.role,
      action: "FIELD_PERMISSIONS_UPDATED",
      detail: `${updated} field rule(s) changed`,
      meta: { changes: changes.slice(0, 50) },
    });

    return ok({ updated, policy: await getFieldPolicy() });
  } catch (error) {
    return handleError(error);
  }
}
