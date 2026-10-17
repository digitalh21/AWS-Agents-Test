"use client";

import { useMemo, useState } from "react";
import { Check, Clapperboard, Copy, Megaphone, PlayCircle, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, EmptyState, Input, Label, NativeSelect, SectionCard } from "@/components/ui/field";
import { PLAYER_THEMES, buildThemedEmbed, iframeSnippet, isDirectVideoFile, playerTheme, toEmbedUrl } from "@/lib/video";
import { cn } from "@/lib/utils";

/** Themed preview: branded frame + brand-masked embed (KillerPlayer style). */
function ThemedFrame({ url, themeKey, title }: { url: string; themeKey: string; title: string }) {
  const theme = playerTheme(themeKey);
  const embed = buildThemedEmbed(url, themeKey);
  const direct = isDirectVideoFile(url.trim());
  if (!embed && !direct) return null;
  return (
    <div
      className="overflow-hidden border shadow-lg"
      style={{ borderRadius: theme.radius, background: theme.frameBg, borderColor: `${theme.accent}55` }}
    >
      {/* frame title bar */}
      <div className="flex items-center gap-2 px-3 py-2" style={{ background: theme.frameBg }}>
        <span className="flex gap-1">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        </span>
        <p className="min-w-0 flex-1 truncate text-[11px] font-semibold" style={{ color: theme.titleColor }}>
          {title || "Untitled video"}
        </p>
        <span className="rounded-md px-1.5 py-0.5 text-[9px] font-bold text-white" style={{ background: theme.accent }}>
          {playerTheme(themeKey).name}
        </span>
      </div>
      {/* player area — custom overlays hide the provider's branding controls */}
      <div className="relative aspect-video w-full bg-black" style={{ borderTop: `2px solid ${theme.accent}` }}>
        {direct ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video controls className="absolute inset-0 h-full w-full">
            <source src={url.trim()} />
          </video>
        ) : (
          <iframe
            src={embed}
            title="Themed video preview"
            className="absolute inset-0 h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        )}
        {/* full-width themed gradient strip (visual consistency, clicks pass through) */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-9" style={{ background: theme.strip }} />
        {/* accent progress styling */}
        <div className="pointer-events-none absolute bottom-1.5 left-2 right-2 flex items-center gap-2">
          <PlayCircle className="h-4 w-4 shrink-0 text-white/90" />
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/25">
            <div className="h-full w-1/3 rounded-full" style={{ background: theme.accent }} />
          </div>
        </div>
        {/* opaque logo shield: covers the provider logo corner of the control
            bar AND swallows clicks on it (KillerPlayer-style concealment) */}
        <div
          aria-hidden
          className="absolute bottom-0 right-0 z-10 h-9 w-32"
          style={{
            background: `linear-gradient(to left, ${theme.frameBg} 25%, ${theme.frameBg}CC 60%, transparent)`,
            borderTopLeftRadius: theme.radius,
          }}
          onClick={(e) => e.stopPropagation()}
        />
        {/* provider title row conceal (top-left, pre-play state) */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-0 top-0 z-10 h-12 w-64"
          style={{ background: `linear-gradient(${theme.frameBg}E6, transparent)` }}
        />
        <div className="pointer-events-none absolute left-2 top-1.5 z-10 flex items-center gap-1.5">
          <span className="rounded-md px-1.5 py-0.5 text-[9px] font-bold text-white shadow" style={{ background: theme.accent }}>
            {playerTheme(themeKey).name} Player
          </span>
        </div>
      </div>
    </div>
  );
}

export function VideoStudio() {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [themeKey, setThemeKey] = useState("wistia");
  const embed = useMemo(() => (url.trim() ? buildThemedEmbed(url.trim(), themeKey) : ""), [url, themeKey]);
  const theme = playerTheme(themeKey);
  const [copied, setCopied] = useState<"url" | "html" | null>(null);

  async function copy(kind: "url" | "html", value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      toast.success(kind === "url" ? "Embed URL copied" : "Iframe HTML copied");
      setTimeout(() => setCopied(null), 1600);
    } catch {
      toast.error("Clipboard unavailable — copy manually");
    }
  }

  return (
    <div className="space-y-3 p-3 sm:p-4 lg:p-6">
      <SectionCard title="Video iFrame Studio" icon={<Clapperboard className="h-3.5 w-3.5" />}>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
          {/* ------------- controls ------------- */}
          <div className="space-y-2 lg:col-span-2">
            <div className="space-y-1">
              <Label>Video URL (YouTube / Vimeo / Drive / direct .mp4)</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" />
            </div>
            <div className="space-y-1">
              <Label>Overlay title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Weekend sprint briefing" />
            </div>
            <div className="space-y-1">
              <Label>Player skin</Label>
              <NativeSelect value={themeKey} onChange={(e) => setThemeKey(e.target.value)}>
                {PLAYER_THEMES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.name}
                  </option>
                ))}
              </NativeSelect>
            </div>

            {/* theme gallery */}
            <div className="grid grid-cols-5 gap-1.5 pt-1">
              {PLAYER_THEMES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setThemeKey(t.key)}
                  className={cn(
                    "rounded-lg border p-1.5 text-center transition",
                    themeKey === t.key ? "border-blue-500 bg-blue-50 ring-1 ring-blue-400" : "bg-white hover:bg-slate-50",
                  )}
                >
                  <span className="mx-auto block h-5 w-full rounded" style={{ background: t.accent }} />
                  <span className="mt-1 block text-[9px] font-bold">{t.name}</span>
                </button>
              ))}
            </div>

            <div className="space-y-1.5 rounded-xl border bg-slate-50 p-2.5">
              <p className="flex items-center gap-1 text-[11px] font-bold text-slate-600">
                <Wand2 className="h-3.5 w-3.5" /> Brand-hiding embed output
              </p>
              <p className="break-all rounded-lg border bg-white p-2 text-[10px] text-slate-500">
                {embed || "Paste a video URL to generate the embed link."}
              </p>
              <div className="flex gap-1.5">
                <Button size="xs" variant="outline" className="flex-1" disabled={!embed} onClick={() => void copy("url", embed)}>
                  {copied === "url" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} Copy URL
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  className="flex-1"
                  disabled={!embed}
                  onClick={() => void copy("html", iframeSnippet(embed, theme.radius))}
                >
                  {copied === "html" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} Copy iframe HTML
                </Button>
              </div>
              <p className="flex items-center gap-1 pt-0.5 text-[10px] text-muted-foreground">
                <Megaphone className="h-3 w-3" /> Paste the embed URL into a broadcast&apos;s Video URL field to send this
                player to agents.
              </p>
            </div>
          </div>

          {/* ------------- live preview ------------- */}
          <div className="lg:col-span-3">
            {url.trim() ? (
              <ThemedFrame url={url} themeKey={themeKey} title={title} />
            ) : (
              <EmptyState
                title="Live preview"
                hint="Paste a video URL, pick a Wistia / Vimeo / Viddler / Vzaar / Tara skin, and the branded player renders here."
                icon="🎬"
              />
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge variant="muted">YouTube logo masked</Badge>
              <Badge variant="muted">rel=0</Badge>
              <Badge variant="muted">modestbranding</Badge>
              <Badge variant="muted">autoplay off</Badge>
              <Badge variant="muted">accent: {theme.name}</Badge>
            </div>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
