import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { signHmac } from "@/lib/password";

// Re-exported from the pure (Next-free) module so CLI scripts like
// src/db/seed.ts can hash/verify without importing next/headers.
export { hashPassword, verifyPassword } from "@/lib/password";

export const SESSION_COOKIE = "tc_session";
const SECRET = process.env.AUTH_SECRET ?? "telecalling-crm-dev-secret";

export type Role = "ADMIN" | "HR" | "MANAGER" | "AGENT";

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  phone: string | null;
  primaryNicheId: number | null;
};

function sign(payload: string) {
  return signHmac(payload, SECRET);
}

export function encodeSession(userId: string) {
  const payload = `${userId}.${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Coerces an untrusted value (JSON body / query string) into a user UUID,
 * or null when the value is not a well-formed UUID.
 * Replaces the old `Number(body.userId)` pattern now that ids are UUIDs.
 */
export function asUserId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return UUID_RE.test(v) ? v : null;
}

export function decodeSession(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [id, ts, sig] = parts;
  if (sign(`${id}.${ts}`) !== sig) return null;
  // user ids are UUID strings now — reject anything else instead of Number() parsing
  return UUID_RE.test(id) ? id : null;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const userId = decodeSession(store.get(SESSION_COOKIE)?.value);
  if (!userId) return null;
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      phone: users.phone,
      primaryNicheId: users.primaryNicheId,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row || !row.isActive) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role as Role,
    phone: row.phone,
    primaryNicheId: row.primaryNicheId,
  };
}

export const STAFF_ROLES: Role[] = ["ADMIN", "HR", "MANAGER"];

export function isStaff(role: Role | string) {
  return STAFF_ROLES.includes(role as Role);
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new HttpError(401, "Not authenticated");
  return user;
}

export async function requireStaff(): Promise<SessionUser> {
  const user = await requireUser();
  if (!isStaff(user.role)) throw new HttpError(403, "Staff access required");
  return user;
}

export async function requireRole(roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) throw new HttpError(403, "Insufficient permissions");
  return user;
}

export async function setSessionCookie(userId: string) {
  const store = await cookies();
  store.set(SESSION_COOKIE, encodeSession(userId), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/* ------------------------------------------------------------------ */
/* Secure management impersonation ("Switch as User" / View as Agent)  */
/* ------------------------------------------------------------------ */

export const IMPERSONATOR_COOKIE = "tc_impersonator";

/**
 * Stores the ORIGINAL staff user's id in a signed cookie while the session
 * cookie is swapped to the impersonated account. HMAC-signed, httpOnly.
 */
export async function setImpersonatorCookie(staffUserId: string) {
  const store = await cookies();
  const payload = `${staffUserId}.${Date.now()}`;
  store.set(IMPERSONATOR_COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12, // 12h hard cap for any impersonation session
  });
}

/** Returns the original staff user id when impersonating, else null. */
export async function getImpersonatorId(): Promise<string | null> {
  const store = await cookies();
  return decodeSession(store.get(IMPERSONATOR_COOKIE)?.value);
}

export async function clearImpersonatorCookie() {
  const store = await cookies();
  store.delete(IMPERSONATOR_COOKIE);
}

/** Server-component guard: staff-only pages bounce agents back to the agent console. */
export async function requireStaffPage(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isStaff(user.role)) redirect("/agent");
  return user;
}

/** Server-component guard: agent-only pages bounce staff to the pipeline. */
export async function requireAgentPage(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "AGENT") redirect("/pipeline");
  return user;
}
