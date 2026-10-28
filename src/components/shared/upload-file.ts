"use client";

import { toast } from "sonner";

export type UploadResult = {
  ok: boolean;
  /** URL to render/preview — ALWAYS usable, even if remote storage failed */
  url: string;
  /** canonical remote url (B2) when available */
  remoteUrl?: string;
  /** inline base64 data URL — the local fallback preview source */
  dataUrl?: string;
  id?: number;
  driver?: "b2" | "postgres" | "client-base64";
  name: string;
  error?: string;
};

const MAX_BYTES = 25 * 1024 * 1024;

function toDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Resilient image/document upload.
 *
 * Order of attempts:
 *   1. POST /api/upload  → server stores to Backblaze B2 and persists the URL
 *   2. If the network/CORS/policy layer blocks or the server errors, the file is
 *      read locally as an inline base64 data URL so the preview ALWAYS renders.
 *
 * `dataUrl` is returned in both cases; `remoteUrl` is only set on success (1).
 */
export async function uploadFile(
  file: File,
  opts: { leadId?: number; kind?: string; userId?: number; silent?: boolean } = {},
): Promise<UploadResult> {
  const kind = opts.kind ?? "PROOF";

  if (file.size > MAX_BYTES) {
    return { ok: false, url: "", name: file.name, error: "File too large (max 25MB)" };
  }

  // Read the local preview up front — used as the fallback and for instant display.
  let dataUrl: string | undefined;
  try {
    dataUrl = await toDataUrl(file);
  } catch {
    dataUrl = undefined;
  }

  try {
    const form = new FormData();
    form.append("file", file);
    form.append("kind", kind);
    if (opts.leadId) form.append("leadId", String(opts.leadId));

    const res = await fetch("/api/upload", { method: "POST", body: form });

    // Some proxies/CORS policies return opaque or HTML bodies — guard the parse.
    let json: {
      id?: number;
      url?: string;
      proxyUrl?: string;
      previewUrl?: string;
      storageKey?: string;
      driver?: string;
      error?: string;
    } = {};
    try {
      json = (await res.json()) as typeof json;
    } catch {
      json = {};
    }

    if (!res.ok || !json.url) {
      const msg = json.error ?? `Upload failed (${res.status})`;
      if (!opts.silent) toast.warning(`${msg} — showing a local preview instead.`);
      return { ok: false, url: dataUrl ?? "", dataUrl, name: file.name, error: msg };
    }

    if (!opts.silent) toast.success("File uploaded");
    return {
      ok: true,
      // render through the secure proxy (works for PRIVATE B2 buckets, owner + mgmt only)
      url: json.previewUrl ?? json.proxyUrl ?? json.url ?? "",
      remoteUrl: json.url,
      dataUrl,
      id: json.id,
      driver: (json.driver as UploadResult["driver"]) ?? "b2",
      name: file.name,
    };
  } catch (e) {
    // Network / CORS / policy failure — never leave the UI without a preview.
    const msg = e instanceof Error ? e.message : "Upload blocked";
    if (!opts.silent) toast.warning(`${msg} — using a local preview. Try again to save it.`);
    return { ok: false, url: dataUrl ?? "", dataUrl, name: file.name, error: msg };
  }
}
