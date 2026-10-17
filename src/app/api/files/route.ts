import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { uploads, users } from "@/db/schema";
import { handleError, ok } from "@/lib/api";
import { asUserId, requireStaff } from "@/lib/auth";
import { b2Configured } from "@/lib/b2";
import { ensureTables } from "@/db/bootstrap";

export const dynamic = "force-dynamic";

type FileTab = "images" | "pdfs" | "videos" | "others" | "manual";

const TABS: FileTab[] = ["images", "pdfs", "videos", "others", "manual"];

function typeWhere(tab: FileTab) {
  switch (tab) {
    case "images":
      return sql`${uploads.mimeType} ilike 'image/%' and upper(coalesce(${uploads.kind}, '')) <> 'MANUAL'`;
    case "pdfs":
      return sql`${uploads.mimeType} = 'application/pdf' and upper(coalesce(${uploads.kind}, '')) <> 'MANUAL'`;
    case "videos":
      return sql`${uploads.mimeType} ilike 'video/%' and upper(coalesce(${uploads.kind}, '')) <> 'MANUAL'`;
    case "others":
      return sql`${uploads.mimeType} not ilike 'image/%' and ${uploads.mimeType} <> 'application/pdf' and ${uploads.mimeType} not ilike 'video/%' and upper(coalesce(${uploads.kind}, '')) <> 'MANUAL'`;
    case "manual":
      return sql`upper(coalesce(${uploads.kind}, '')) = 'MANUAL'`;
  }
}

/**
 * Central File Storage Manager (management only).
 *
 * GET ?type=images|pdfs|videos|others|manual&userId=<uuid>
 * Rows carry the Backblaze B2 metadata (storage driver + object key) synced
 * from B2 at upload time; uploader names resolve from the users table.
 */
export async function GET(request: Request) {
  try {
    await ensureTables();
    await requireStaff();
    const url = new URL(request.url);
    const rawTab = (url.searchParams.get("type") ?? "images").toLowerCase();
    const tab: FileTab = (TABS as string[]).includes(rawTab) ? (rawTab as FileTab) : "images";
    const userId = asUserId(url.searchParams.get("userId"));

    const userFilter = userId ? eq(uploads.userId, userId) : undefined;

    const rows = await db
      .select({
        id: uploads.id,
        url: uploads.externalUrl,
        storageKey: uploads.storageKey,
        storageDriver: uploads.storageDriver,
        kind: uploads.kind,
        fileName: uploads.fileName,
        mimeType: uploads.mimeType,
        sizeBytes: uploads.sizeBytes,
        createdAt: uploads.createdAt,
        leadId: uploads.leadId,
        userId: uploads.userId,
        userName: users.name,
        userRole: users.role,
      })
      .from(uploads)
      .leftJoin(users, eq(users.id, uploads.userId))
      .where(and(typeWhere(tab), userFilter))
      .orderBy(desc(uploads.createdAt))
      .limit(200);

    const counts: Record<string, number> = {};
    await Promise.all(
      TABS.map(async (t) => {
        const [row] = await db
          .select({ value: sql<number>`count(*)::int` })
          .from(uploads)
          .where(and(typeWhere(t), userFilter));
        counts[t] = Number(row?.value ?? 0);
      }),
    );

    return ok({ rows, counts, tab, b2: b2Configured() });
  } catch (error) {
    return handleError(error);
  }
}
