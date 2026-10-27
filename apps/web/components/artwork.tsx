"use client";
import { ImageOff } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Provider artwork with a reserved frame.
 *
 * The frame is always rendered by the caller when a card has an image, so a
 * third-party image that never loads cannot reflow the layout. A failed load
 * shows a neutral placeholder instead of a broken-image glyph.
 *
 * A plain `img` on purpose: `next/image` would proxy third-party URLs through
 * this server, which turns any provider-supplied URL into an SSRF surface. The
 * URL is validated with `safeImageUrl()` before it reaches this component.
 */
export function CoverArt({
  url,
  className,
  failureLabel = "Image unavailable",
}: {
  url: string;
  className?: string;
  failureLabel?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-muted text-muted-foreground",
          className
        )}
        title="This image did not load."
      >
        <ImageOff aria-hidden className="size-5" />
        <span className="sr-only">{failureLabel}</span>
      </div>
    );
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn("object-cover", className)}
    />
  );
}
