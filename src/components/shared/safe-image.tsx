"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Image that never renders broken.
 * Shows a placeholder while loading and on error (missing file, private bucket,
 * expired link), so KYC docs, proofs and avatars degrade gracefully.
 */
export function SafeImage({
  src,
  alt,
  className,
  fallbackLabel = "Preview unavailable",
}: {
  src?: string | null;
  alt: string;
  className?: string;
  fallbackLabel?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-1 bg-slate-100 text-slate-400",
          className,
        )}
        title={failed ? fallbackLabel : alt}
      >
        <ImageOff className="h-4 w-4" />
        {failed ? <span className="px-1 text-[8px] leading-tight">{fallbackLabel}</span> : null}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      onLoad={() => setLoaded(true)}
      className={cn(className, !loaded && "bg-slate-100")}
    />
  );
}
