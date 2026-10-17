import { createHmac, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Pure password hashing helpers (no Next.js imports) so they can be used
 * both inside the app runtime and from standalone CLI scripts (tsx).
 */
export function hashPassword(password: string) {
  const salt = "tc-crm-static-salt";
  return scryptSync(password, salt, 32).toString("hex");
}

export function verifyPassword(password: string, hash: string) {
  const candidate = Buffer.from(hashPassword(password), "hex");
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export function signHmac(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("hex").slice(0, 32);
}
