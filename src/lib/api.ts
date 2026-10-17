import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { HttpError } from "./auth";

export function ok<T>(data: T, init?: number) {
  return NextResponse.json(data as Record<string, unknown> | T, { status: init ?? 200 });
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function handleError(error: unknown) {
  if (error instanceof HttpError) return fail(error.message, error.status);
  console.error("[api]", error);
  const message = error instanceof Error ? error.message : "Unexpected server error";
  return fail(message, 500);
}

export async function audit(entry: {
  actorId?: string | null;
  actorRole?: string | null;
  leadId?: number | null;
  action: string;
  detail?: string;
  meta?: Record<string, unknown>;
}) {
  await db.insert(auditLogs).values({
    actorId: entry.actorId ?? null,
    actorRole: entry.actorRole ?? null,
    leadId: entry.leadId ?? null,
    action: entry.action,
    detail: entry.detail ?? null,
    meta: entry.meta ?? null,
  });
}

export function parseIntOr(value: string | null | undefined, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}
