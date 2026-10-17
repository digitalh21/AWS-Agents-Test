import crypto from "node:crypto";

/**
 * Backblaze B2 client using the S3-compatible API.
 *
 * The S3 API is used (rather than the B2 native API) because it accepts the
 * bucket NAME — application keys scoped to a single bucket cannot call
 * b2_list_buckets / b2_get_bucket to resolve a bucketId.
 *
 * Region is derived from the B2_S3_REGION env var, defaulting to us-east-005
 * (self-corrected to the bucket's actual region after b2_authorize_account).
 *
 * B2_PUBLIC_URL (optional): public CDN / custom-domain base that fronts the
 * bucket, e.g. "https://cdn.example.com" or the native
 * "https://f005.backblazeb2.com/file/<bucket>". When set, stored file URLs are
 * "B2_PUBLIC_URL/<object-key>".
 */

/** Cached account info (region + hosts come from b2_authorize_account). */
let accountInfo: { s3Host: string; downloadUrl: string } | null = null;
let accountFetchedAt = 0;
const ACCOUNT_TTL_MS = 60 * 60 * 1000;

/** Fallback region if authorization has not happened yet. */
const DEFAULT_REGION = "us-east-005";

function regionSlug() {
  const raw = (process.env.B2_S3_REGION || process.env.B2_REGION || DEFAULT_REGION).trim();
  if (/^[a-z]{2}-[a-z]+-\d{3}$/i.test(raw)) return raw.toLowerCase();
  return DEFAULT_REGION;
}

/** Extracts "us-east-005" from an authorized host like s3.us-east-005.backblazeb2.com. */
function regionFromHost(h: string): string | null {
  const m = /s3\.([a-z]{2}-[a-z]+-\d{3})\./i.exec(h);
  return m?.[1]?.toLowerCase() ?? null;
}

/**
 * Resolves the authoritative S3 host + download host.
 * Always correct regardless of how B2_S3_REGION is written ("us-east-005" or "US East").
 */
async function getAccount(force = false) {
  if (!force && accountInfo && Date.now() - accountFetchedAt < ACCOUNT_TTL_MS) return accountInfo;
  if (!b2Configured()) return null;
  const { accessKey, secretKey } = creds();
  try {
    const res = await fetch("https://api.backblazeb2.com/b2api/v2/b2_authorize_account", {
      headers: { Authorization: `Basic ${Buffer.from(`${accessKey}:${secretKey}`).toString("base64")}` },
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("[b2] authorize failed", res.status);
      return null;
    }
    const j = (await res.json()) as { s3ApiUrl: string; downloadUrl: string };
    const s3Host = j.s3ApiUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
    accountInfo = { s3Host, downloadUrl: j.downloadUrl.replace(/\/$/, "") };
    accountFetchedAt = Date.now();
    return accountInfo;
  } catch (e) {
    console.error("[b2] authorize error", e);
    return null;
  }
}

/** S3 host (e.g. s3.us-east-005.backblazeb2.com) — fetched live. */
async function host() {
  return (await getAccount())?.s3Host ?? `s3.${regionSlug()}.backblazeb2.com`;
}

export type B2Upload = {
  key: string;
  /** canonical B2 URL (works when the bucket is public) */
  url: string;
  /**
   * The URL to persist on the file record: the CDN/custom-domain URL when
   * B2_PUBLIC_URL is configured, otherwise the canonical B2 URL.
   */
  publicUrl: string;
  /** the authoritative download host returned by b2_authorize_account */
  downloadUrl: string;
  /** presigned GET url — works even when the bucket is private */
  presignedUrl: string;
  fileId?: string;
  size: number;
  contentType: string;
};

const sha256hex = (b: crypto.BinaryLike) => crypto.createHash("sha256").update(b).digest("hex");
const hmac = (k: crypto.BinaryLike, d: crypto.BinaryLike) => crypto.createHmac("sha256", k).update(d).digest();

export function b2Configured() {
  return Boolean(process.env.B2_KEY_ID && process.env.B2_APP_KEY && process.env.B2_BUCKET);
}

function creds() {
  return {
    accessKey: process.env.B2_KEY_ID!,
    secretKey: process.env.B2_APP_KEY!,
    bucket: process.env.B2_BUCKET!,
  };
}

/** Authorizes and returns the account-scoped download host (f005… style). */
export async function authorize(): Promise<{ downloadUrl: string; s3Host: string } | null> {
  if (!b2Configured()) return null;
  const { accessKey, secretKey } = creds();
  try {
    const res = await fetch("https://api.backblazeb2.com/b2api/v2/b2_authorize_account", {
      headers: { Authorization: `Basic ${Buffer.from(`${accessKey}:${secretKey}`).toString("base64")}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { downloadUrl: string; s3ApiUrl: string };
    return { downloadUrl: j.downloadUrl, s3Host: j.s3ApiUrl.replace(/^https:\/\/s3\./, "s3.") };
  } catch {
    return null;
  }
}

/** Canonical (non-presigned) URL for an object. */
export function canonicalUrl(key: string, downloadHost?: string | null) {
  const { bucket } = creds();
  if (downloadHost) return `${downloadHost}/file/${bucket}/${key}`;
  const m = regionSlug().match(/(\d{3})$/);
  return `https://f${m?.[1] ?? "005"}.backblazeb2.com/file/${bucket}/${key}`;
}

/**
 * Public-facing URL for an object: the B2_PUBLIC_URL (CDN / custom domain)
 * base when configured, otherwise the canonical B2 URL.
 *
 * The env value is normalized because dashboard-pasted bases are often
 * truncated:  "//host" regains its https: scheme; a bare native download
 * host (fNNN.backblazeb2.com) gains the /file/<bucket> path; anything that
 * still is not a plausible absolute URL (needs sub.domain.tld) is ignored in
 * favor of the canonical B2 URL, so file records NEVER persist junk.
 */
export function publicUrl(key: string, downloadHost?: string | null) {
  const { bucket } = creds();
  let base = (process.env.B2_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
  if (base && !/^https?:\/\//i.test(base)) {
    base = base.startsWith("//") ? `https:${base}` : `https://${base}`;
  }
  const looksValid = base && /^https:\/\/[^/.]+\.[^/.]+\.[^/.]+/i.test(base);
  if (looksValid) {
    if (
      /(?:^|\.)backblazeb2\.com$/i.test(base.replace(/^https?:\/\//, "").replace(/\/$/, "").replace(/\/.*/, "")) &&
      !/\/file\/[^/]+/i.test(base)
    ) {
      base = `${base}/file/${bucket}`;
    }
    return `${base}/${key}`;
  }
  return canonicalUrl(key, downloadHost);
}

/** Presigned GET url — the only URL form that works on a private bucket. */
export async function presignedGet(key: string, expiresSeconds = 60 * 60 * 24 * 7) {
  const { accessKey, secretKey, bucket } = creds();
  const H = await host();
  const now = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = now.slice(0, 8);
  const region = regionFromHost(H) ?? regionSlug();
  const scope = `${date}/${region}/s3/aws4_request`;
  const params = new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${accessKey}/${scope}`,
    "X-Amz-Date": now,
    "X-Amz-Expires": String(Math.min(Math.max(expiresSeconds, 60), 604800)),
    "X-Amz-SignedHeaders": "host",
  });
  const canonicalQuery = params.toString();
  const canonicalRequest = ["GET", `/${bucket}/${key}`, canonicalQuery, `host:${H}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", now, scope, sha256hex(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, date), region), "s3"), "aws4_request");
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  return `https://${H}/${bucket}/${key}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** Uploads bytes to B2. Returns null when B2 is not configured or the call fails. */
export async function b2Upload(
  fileName: string,
  file: Buffer,
  contentType: string,
): Promise<B2Upload | null> {
  if (!b2Configured()) return null;
  const { accessKey, secretKey, bucket } = creds();

  const H = (await host()) || `s3.${regionSlug()}.backblazeb2.com`;
  const region = regionFromHost(H) ?? regionSlug();
  const key = `${new Date().toISOString().slice(0, 10)}/${Date.now()}-${fileName.replace(/[^\w.\-]/g, "_")}`;
  const now = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = now.slice(0, 8);
  const payloadHash = sha256hex(file);

  const canonicalHeaders = `content-type:${contentType}\nhost:${H}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${now}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = ["PUT", `/${bucket}/${key}`, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${date}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", now, scope, sha256hex(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, date), region), "s3"), "aws4_request");
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  try {
    const res = await fetch(`https://${H}/${bucket}/${key}`, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
        "x-amz-date": now,
        "x-amz-content-sha256": payloadHash,
      },
      body: new Uint8Array(file),
      cache: "no-store",
    });
    if (!res.ok) {
      console.error("[b2] upload failed", res.status, (await res.text()).slice(0, 200));
      return null;
    }

    const auth = await authorize();
    const downloadHost = auth?.downloadUrl ?? null;

    return {
      key,
      url: canonicalUrl(key, downloadHost),
      publicUrl: publicUrl(key, downloadHost),
      downloadUrl: downloadHost ?? canonicalUrl(key),
      presignedUrl: await presignedGet(key),
      fileId: res.headers.get("x-amz-request-id") ?? undefined,
      size: file.length,
      contentType,
    };
  } catch (e) {
    console.error("[b2] upload error", e);
    return null;
  }
}

/**
 * Fetches an object's bytes using the application key (works on PRIVATE buckets).
 * A Range header is passed through so video/audio seeking works via the proxy.
 */
export async function b2Fetch(
  key: string,
  range?: string | null,
): Promise<{ body: ArrayBuffer; contentType: string; status: number; contentRange: string | null } | null> {
  const url = await presignedGet(key, 300);
  try {
    const res = await fetch(url, {
      cache: "no-store",
      ...(range ? { headers: { Range: range } } : {}),
    });
    if (!res.ok && res.status !== 206) return null;
    return {
      body: await res.arrayBuffer(),
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
      status: res.status,
      contentRange: res.headers.get("content-range"),
    };
  } catch {
    return null;
  }
}
