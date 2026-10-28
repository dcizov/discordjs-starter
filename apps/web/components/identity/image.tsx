"use client";
import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";

type Props = {
  id: string;
  name: string;
  src?: string | null;
  kind: "guild" | "user";
  /** 24 is the compact table size; 28–33 are header/profile sizes. */
  size: 24 | 28 | 30 | 33;
};
export function IdentityImage(props: Props) {
  // A different identity or metadata URL gets a fresh load/error lifecycle.
  return (
    <ImageWithFallback key={`${props.id}:${props.src ?? ""}`} {...props} />
  );
}
function ImageWithFallback({ name, src, kind, size }: Props) {
  const [failed, setFailed] = useState(false);
  const initials =
    name
      .trim()
      .split(/\s+/)
      .filter((part) => kind !== "guild" || part.toLowerCase() !== "the")
      .slice(0, 2)
      .map((part) => Array.from(part)[0])
      .join("") || "?";
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden border text-[11px] font-semibold",
        kind === "guild"
          ? "rounded-[9px] border-violet-200/60 bg-[#ece6fb] text-violet-700"
          : "rounded-full border-amber-200 dark:border-amber-500/40 bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-300",
        size === 24 && "text-[10px]"
      )}
    >
      <span>{initials}</span>
      {src && !failed && (
        <Image
          src={src}
          width={size}
          height={size}
          alt=""
          /*
           * Bundled illustrations are served from `/public` and are SVGs. Next's
           * optimizer refuses SVG unless `dangerouslyAllowSVG` is turned on,
           * which would permit script-bearing SVG for every image in the app —
           * a real risk taken to solve a cosmetic one. Assets we ship
           * ourselves need no optimization anyway, so they bypass it.
           *
           * Discord CDN avatars keep going through the optimizer; they are
           * remote, already WebP, and allowlisted in `next.config.mjs`.
           */
          unoptimized={src.startsWith("/")}
          className="absolute inset-0 size-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
