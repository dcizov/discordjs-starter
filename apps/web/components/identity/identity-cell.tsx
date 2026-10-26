"use client";
import { cn } from "@/lib/utils";
import { ActorAvatar } from "./actor-avatar";

/**
 * One identity cell: picture first, name second, optional quiet extras.
 *
 * Every table that lists people used to assemble this by hand, which is how the
 * leaderboard ended up drawing a bare initial while the audit log already had
 * real avatars. The pieces are shared here instead:
 *
 * - `src` is a **server-derived** URL, so nothing is fetched per row;
 * - a recorded avatar always wins, a bot without one falls back to the Orbit
 *   glyph, and everyone else falls back to initials;
 * - the picture is decorative (`aria-hidden`), so the name is read once.
 */
export function IdentityCell({
  id,
  name,
  src,
  size = 24,
  badge,
  detail,
  className,
}: {
  id: string;
  name: string;
  src?: string | null;
  size?: 24 | 28 | 30 | 33;
  /** e.g. a "You" marker. Rendered next to the name, never instead of it. */
  badge?: React.ReactNode;
  /** Second line: a role, an id, a timestamp. */
  detail?: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <ActorAvatar id={id} name={name} src={src} size={size} />
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium">{name}</span>
          {badge}
        </span>
        {detail ? (
          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
            {detail}
          </span>
        ) : null}
      </span>
    </span>
  );
}
