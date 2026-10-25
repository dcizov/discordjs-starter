"use client";
import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/utils";

type Props = {
  id: string;
  name: string;
  src?: string | null;
  kind: "guild" | "user";
  size: 28 | 30 | 33;
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
          : "rounded-full border-[#e6d5bb] bg-[#f3e7d4] text-[#795d3d]"
      )}
    >
      <span>{initials}</span>
      {src && !failed && (
        <Image
          src={src}
          width={size}
          height={size}
          alt=""
          className="absolute inset-0 size-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
