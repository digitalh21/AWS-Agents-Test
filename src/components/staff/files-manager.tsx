"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Cloud,
  Database,
  File as FileIcon,
  FileAudio,
  FileText,
  FileVideo,
  Filter,
  Image as ImageIcon,
  Loader2,
  RefreshCcw,
  Trash2,
  UploadCloud,
  Eye,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, Label, NativeSelect, SectionCard } from "@/components/ui/field";
import { SafeImage } from "@/components/shared/safe-image";
import { cn, num, timeAgo } from "@/lib/utils";

type FileRow = {
  id: number;
  url: string | null;
  storageKey: string | null;
  storageDriver: string | null;
  kind: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
  leadId: number | null;
  userId: string;
  userName: string | null;
  userRole: string | null;
};

type Tab = { key: string; label: string; icon: typeof ImageIcon };

const TABS: Tab[] = [
  { key: "images", label: "Images", icon: ImageIcon },
  { key: "pdfs", label: "PDFs", icon: FileText },
  { key: "videos", label: "Videos", icon: FileVideo },
  { key: "others", label: "Others", icon: FileIcon },
  { key: "manual", label: "Manual Uploads", icon: UploadCloud },
];

type UserOption = { id: string; name: string; role: string };

function sizeLabel(bytes: number | null) {
  const b = bytes ?? 0;
  if (b > 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  if (b > 1024) return `${Math.round(b / 1024)} KB`;
  return `${b} B`;
}

function fileIcon(mime: string | null) {
  if (mime?.startsWith("image/")) return ImageIcon;
  if (mime === "application/pdf") return FileText;
  if (mime?.startsWith("video/")) return FileVideo;
  if (mime?.startsWith("audio/")) return FileAudio;
  return FileIcon;
}

/**
 * Central File Storage Manager (management only).
 * Tabs split by media type; Manual Uploads stay contained in their own tab.
 * Every row shows the Backblaze B2 metadata synced from the uploads table.
 */
export function FilesManager() {
  const [tab, setTab] = useState("images");
  const [userId, setUserId] = useState("");
  const [users, setUsers] = useState<UserOption[]>([]);
  const [rows, setRows] = useState<FileRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<FileRow | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // esc closes the preview modal
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPreview(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ type: tab });
    if (userId) params.set("userId", userId);
    const [filesRes, agentsRes] = await Promise.all([
      fetch(`/api/files?${params.toString()}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/agents").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (filesRes) {
      setRows(filesRes.rows ?? []);
      setCounts(filesRes.counts ?? {});
    }
    if (agentsRes) setUsers((agentsRes.rows ?? []) as UserOption[]);
    setLoading(false);
  }, [tab, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function upload(file: File) {
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", "MANUAL");
    const res = await fetch("/api/upload", { method: "POST", body: fd });
    const json = (await res.json()) as { error?: string; driver?: string };
    if (res.ok) {
      toast.success(`Uploaded (${json.driver === "b2" ? "Backblaze B2" : "Postgres storage"})`);
      await load();
    } else toast.error(json.error ?? "Upload failed");
    setUploading(false);
  }

  async function remove(id: number) {
    const res = await fetch(`/api/upload?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("File removed");
      await load();
    } else toast.error("Delete failed");
  }

  return (
    <div className="space-y-3 p-3 sm:p-4 lg:p-6">
      {/* ---------- tabs ---------- */}
      <div className="flex gap-1 overflow-x-auto rounded-xl border bg-white p-1 no-scrollbar">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold transition",
              tab === t.key ? "bg-blue-700 text-white shadow" : "text-slate-500 hover:bg-slate-50",
            )}
          >
            <t.icon className="h-3.5 w-3.5" /> {t.label}
            <span className={cn("rounded-full px-1.5 py-0.5 text-[9px]", tab === t.key ? "bg-white/20" : "bg-slate-100")}>
              {num(counts[t.key] ?? 0)}
            </span>
          </button>
        ))}
      </div>

      <SectionCard
        title={TABS.find((t) => t.key === tab)?.label ?? "Files"}
        icon={<Cloud className="h-3.5 w-3.5" />}
        action={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void load()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
            </Button>
          </div>
        }
      >
        {/* ---------- user filter ---------- */}
        <div className="mb-3 flex flex-wrap items-end gap-2 rounded-xl border bg-slate-50 p-2.5">
          <div className="space-y-1">
            <Label className="flex items-center gap-1">
              <Filter className="h-3 w-3" /> Uploaded by user
            </Label>
            <NativeSelect value={userId} onChange={(e) => setUserId(e.target.value)} className="min-w-[220px]">
              <option value="">All users</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.role})
                </option>
              ))}
            </NativeSelect>
          </div>
          {tab === "manual" ? (
            <div className="ml-auto">
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void upload(f);
                  e.target.value = "";
                }}
              />
              <Button size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
                Upload file
              </Button>
            </div>
          ) : null}
        </div>

        {rows.length === 0 && !loading ? (
          <EmptyState
            title={tab === "manual" ? "No manual uploads yet" : "Nothing stored here yet"}
            hint={
              tab === "manual"
                ? "Files you upload from this tab stay contained here — KYC / proof / broadcast files never mix in."
                : "Files appear automatically as agents upload KYC documents, proofs and broadcast attachments."
            }
            icon="🗄️"
          />
        ) : null}

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {rows.map((f) => {
            const Icon = fileIcon(f.mimeType);
            // secure proxy — streams PRIVATE-B2 bytes with owner/management access control
            const proxy = `/api/files/${f.id}`;
            return (
              <div key={f.id} className="flex gap-2.5 rounded-xl border bg-white p-2.5 shadow-sm">
                {f.mimeType?.startsWith("image/") ? (
                  <SafeImage src={proxy} alt={f.fileName ?? "file"} className="h-16 w-16 shrink-0 rounded-lg object-cover" />
                ) : f.mimeType?.startsWith("video/") ? (
                  <video src={`${proxy}#t=0.1`} muted preload="metadata" className="h-16 w-16 shrink-0 rounded-lg bg-black object-cover" />
                ) : (
                  <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                    <Icon className="h-6 w-6" />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold">{f.fileName ?? `file-${f.id}`}</p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    by <strong>{f.userName ?? "unknown"}</strong> ({f.userRole ?? "—"}) · {timeAgo(f.createdAt)}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[9px]">
                    <Badge variant={f.storageDriver === "b2" ? "success" : "muted"}>
                      {f.storageDriver === "b2" ? <Cloud className="h-2.5 w-2.5" /> : <Database className="h-2.5 w-2.5" />}
                      {f.storageDriver === "b2" ? "Backblaze B2" : "Postgres"}
                    </Badge>
                    <span className="text-muted-foreground">{sizeLabel(f.sizeBytes)}</span>
                    {f.leadId ? <span className="text-muted-foreground">lead #{f.leadId}</span> : null}
                  </p>
                  {f.storageKey ? (
                    <p className="mt-0.5 truncate text-[9px] text-muted-foreground" title={f.storageKey}>
                      B2 key: {f.storageKey}
                    </p>
                  ) : null}
                  <div className="mt-1.5 flex gap-1.5">
                    <button
                      onClick={() => setPreview(f)}
                      className="flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700 hover:bg-blue-100"
                    >
                      <Eye className="h-3 w-3" /> Preview
                    </button>
                    <a
                      href={proxy}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border px-2 py-1 text-[10px] font-bold text-blue-700 hover:bg-blue-50"
                    >
                      Open
                    </a>
                    <a
                      href={`${proxy}?dl=1`}
                      className="rounded-lg border px-2 py-1 text-[10px] font-bold text-slate-600 hover:bg-slate-50"
                      download={f.fileName ?? undefined}
                    >
                      Save
                    </a>
                    <button
                      onClick={() => void remove(f.id)}
                      className="flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-bold text-rose-600 hover:bg-rose-50"
                    >
                      <Trash2 className="h-3 w-3" /> Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      {/* ---------------- full preview modal ---------------- */}
      {preview ? (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm sm:p-6"
          onClick={() => setPreview(null)}
        >
          <div
            className="flex max-h-[92dvh] w-full max-w-3xl animate-sheet flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b px-4 py-2.5">
              <Eye className="h-4 w-4 shrink-0 text-blue-700" />
              <p className="min-w-0 flex-1 truncate text-xs font-bold sm:text-sm">{preview.fileName ?? `file-${preview.id}`}</p>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {preview.userName ?? "unknown"} · {sizeLabel(preview.sizeBytes)}
              </span>
              <a
                href={`/api/files/${preview.id}?dl=1`}
                className="shrink-0 rounded-lg border px-2 py-1 text-[10px] font-bold text-blue-700 hover:bg-blue-50"
                download={preview.fileName ?? undefined}
              >
                Download
              </a>
              <button
                onClick={() => setPreview(null)}
                aria-label="Close preview"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-slate-50 p-3 thin-scroll">
              {(() => {
                const src = `/api/files/${preview.id}`;
                if (preview.mimeType?.startsWith("image/")) {
                  return (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={src} alt={preview.fileName ?? "preview"} className="max-h-[75dvh] max-w-full rounded-lg object-contain" />
                  );
                }
                if (preview.mimeType === "application/pdf") {
                  return <iframe src={src} title="PDF preview" className="h-[75dvh] w-full rounded-lg border bg-white" />;
                }
                if (preview.mimeType?.startsWith("video/")) {
                  return (
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    <video controls className="max-h-[75dvh] w-full rounded-lg bg-black">
                      <source src={src} type={preview.mimeType ?? "video/mp4"} />
                    </video>
                  );
                }
                if (preview.mimeType?.startsWith("audio/")) {
                  return (
                    <div className="w-full max-w-md rounded-xl border bg-white p-6">
                      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                      <audio controls src={src} className="w-full" />
                    </div>
                  );
                }
                return (
                  <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
                    <UploadCloud className="h-10 w-10" />
                    <p className="text-xs">Inline preview isn&apos;t available for this file type — use Download.</p>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
