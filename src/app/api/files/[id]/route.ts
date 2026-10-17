import { eq } from "drizzle-orm";
import { db } from "@/db";
import { uploads } from "@/db/schema";
import { b2Configured, b2Fetch } from "@/lib/b2";
import { getSessionUser, isStaff } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Secure file proxy — the ONLY way bytes are served for B2 rows.
 *
 * Access control (server-side): the uploader or Management (ADMIN | HR |
 * MANAGER) may read a file; anyone else gets 403 and anonymous visitors get
 * 401. Because the bucket is PRIVATE, this route streams the object through
 * a short-lived presigned S3 fetch — no public URL ever reaches the browser.
 *
 * - Content-Type is taken from the stored record (fallback: B2's value).
 * - Content-Disposition: inline for preview, `?dl=1` for attachment download.
 * - Range headers pass through so video/audio seeking works.
 */
function safeName(fileName: string | null): string {
  const base = (fileName ?? "file").split(/[\\/]/).pop() ?? "file";
  // strip characters that could break the header quoting
  return base.replace(/["\r\n]/g, "").slice(0, 120) || "file";
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getSessionUser();
    if (!user) return new Response("Unauthorized", { status: 401 });

    const id = Number((await params).id);
    if (!Number.isFinite(id)) return new Response("Bad request", { status: 400 });

    const [row] = await db
      .select({
        id: uploads.id,
        userId: uploads.userId,
        storageDriver: uploads.storageDriver,
        storageKey: uploads.storageKey,
        externalUrl: uploads.externalUrl,
        mimeType: uploads.mimeType,
        fileName: uploads.fileName,
        sizeBytes: uploads.sizeBytes,
        data: uploads.data,
      })
      .from(uploads)
      .where(eq(uploads.id, id))
      .limit(1);
    if (!row) return new Response("Not found", { status: 404 });

    // owner or management only
    if (row.userId !== user.id && !isStaff(user.role)) {
      return new Response("Forbidden — this file belongs to another user", { status: 403 });
    }

    const disposition = `${new URL(request.url).searchParams.get("dl") ? "attachment" : "inline"}; filename="${safeName(row.fileName)}"`;
    const baseHeaders: Record<string, string> = {
      "Content-Disposition": disposition,
      "Cache-Control": "private, max-age=86400",
      "Accept-Ranges": "bytes",
      "X-Content-Driver": row.storageDriver ?? "postgres",
    };

    // B2 object → stream the bytes through the app (private bucket safe)
    if (row.storageDriver === "b2" && row.storageKey) {
      if (!b2Configured()) return new Response("B2 not configured", { status: 503 });
      const range = request.headers.get("range");
      const obj = await b2Fetch(row.storageKey, range);
      if (!obj) return new Response("Object not available", { status: 404 });
      return new Response(obj.body, {
        status: obj.status === 206 ? 206 : 200,
        headers: {
          "Content-Type": row.mimeType || obj.contentType,
          "Content-Length": String(obj.body.byteLength),
          ...(obj.contentRange ? { "Content-Range": obj.contentRange } : {}),
          ...baseHeaders,
        },
      });
    }

    // legacy row without bytes (external http URL, e.g. CDN) → redirect
    if (row.externalUrl?.startsWith("http")) {
      return Response.redirect(row.externalUrl, 302);
    }

    // Postgres fallback → decode inline copy
    if (!row.data) return new Response("Not found", { status: 404 });
    const [meta, base64] = row.data.split(",");
    const mime = /data:([^;]+)/.exec(meta ?? "")?.[1] ?? row.mimeType ?? "application/octet-stream";
    const bytes = Buffer.from(base64 ?? "", "base64");
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(bytes.length),
        ...baseHeaders,
      },
    });
  } catch {
    return new Response("Could not serve file", { status: 500 });
  }
}
