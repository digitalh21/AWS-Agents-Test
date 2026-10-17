/**
 * Video URL → embed helpers + custom player skins ("KillerPlayer" style):
 * hides YouTube branding via modestbranding params + a themed frame that
 * visually masks the residual logo corner.
 */

/** Converts a watch/share URL into an embeddable iframe URL. */
export function toEmbedUrl(url: string): string | null {
  const yt = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/i.exec(url);
  if (yt?.[1]) return `https://www.youtube.com/embed/${yt[1]}`;
  const vimeo = /vimeo\.com\/(\d+)/i.exec(url);
  if (vimeo?.[1]) return `https://player.vimeo.com/video/${vimeo[1]}`;
  const drive = /drive\.google\.com\/file\/d\/([\w-]+)/i.exec(url);
  if (drive?.[1]) return `https://drive.google.com/file/d/${drive[1]}/preview`;
  return url;
}

export function isDirectVideoFile(url: string) {
  return /\.(mp4|webm|ogv|mov)(\?|#|$)/i.test(url);
}

function isYouTube(url: string) {
  return /(?:youtube\.com|youtu\.be)/i.test(url);
}

/* ------------------------------------------------------------------ */
/* Custom player skins                                                */
/* ------------------------------------------------------------------ */

export type PlayerTheme = {
  key: string;
  name: string;
  /** accent color for frame + fake progress bar */
  accent: string;
  frameBg: string;
  titleColor: string;
  radius: string;
  /** gradient used for the fake control strip */
  strip: string;
};

export const PLAYER_THEMES: PlayerTheme[] = [
  {
    key: "wistia",
    name: "Wistia",
    accent: "#3ea9f5",
    frameBg: "#ffffff",
    titleColor: "#0f172a",
    radius: "18px",
    strip: "linear-gradient(transparent, rgba(15,23,42,0.55))",
  },
  {
    key: "vimeo",
    name: "Vimeo",
    accent: "#17b3e8",
    frameBg: "#0b1016",
    titleColor: "#e2e8f0",
    radius: "14px",
    strip: "linear-gradient(transparent, rgba(0,0,0,0.6))",
  },
  {
    key: "viddler",
    name: "Viddler",
    accent: "#f26822",
    frameBg: "#181a1f",
    titleColor: "#f8fafc",
    radius: "8px",
    strip: "linear-gradient(transparent, rgba(0,0,0,0.65))",
  },
  {
    key: "vzaar",
    name: "Vzaar",
    accent: "#8b5cf6",
    frameBg: "#111827",
    titleColor: "#ede9fe",
    radius: "20px",
    strip: "linear-gradient(transparent, rgba(0,0,0,0.6))",
  },
  {
    key: "tara",
    name: "Tara",
    accent: "#d97706",
    frameBg: "#fff7ed",
    titleColor: "#431407",
    radius: "16px",
    strip: "linear-gradient(transparent, rgba(67,20,7,0.55))",
  },
];

export function playerTheme(key: string | null | undefined): PlayerTheme {
  return PLAYER_THEMES.find((t) => t.key === key) ?? PLAYER_THEMES[0]!;
}

/**
 * Brand-hidden embed URL (KillerPlayer approach):
 *  - YouTube: privacy-enhanced youtube-nocookie host + rel=0 + modestbranding
 *    + annotation/info cards off. The custom frame overlay in the studio masks
 *    the residual corner logo and swallows clicks on it.
 *  - Vimeo: title/byline/portrait stripped, theme accent as progress color.
 */
export function buildThemedEmbed(rawUrl: string, themeKey: string): string {
  const theme = playerTheme(themeKey);
  const src = rawUrl.trim();
  const base = toEmbedUrl(src);
  if (!base) return "";
  if (isYouTube(src)) {
    const nocookie = base.replace("www.youtube.com", "www.youtube-nocookie.com");
    const params = new URLSearchParams({
      rel: "0",
      modestbranding: "1",
      iv_load_policy: "3",
      controls: "1",
      playsinline: "1",
      disablekb: "0",
      cc_load_policy: "0",
      vq: "hd1080",
    });
    return `${nocookie}?${params.toString()}`;
  }
  if (/player\.vimeo\.com\/video\//i.test(base)) {
    const params = new URLSearchParams({
      title: "0",
      byline: "0",
      portrait: "0",
      dnt: "1",
      color: theme.accent.replace("#", ""),
    });
    return `${base}?${params.toString()}`;
  }
  return base;
}

/** Copy-paste iframe HTML for external use. */
export function iframeSnippet(embedUrl: string, radius: string) {
  return `<div style="position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;border-radius:${radius};background:#000">
  <iframe src="${embedUrl}" title="Video" style="position:absolute;inset:0;width:100%;height:100%;border:0"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
</div>`;
}
