"use client";
import { cn } from "@/lib/utils";
import { personFields, type PersonFields } from "@/lib/person";
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
  person,
  context = "guild",
  size = 24,
  badge,
  detail,
  className,
}: {
  id: string;
  /** Fallback: a name already recorded elsewhere (a queue payload, an account). */
  name: string;
  src?: string | null;
  /**
   * Roster identity for this person. When present the shared resolver decides
   * the name and the secondary handle, so a row cannot use one precedence rule
   * while the row next to it uses another.
   */
  person?: PersonFields;
  context?: "guild" | "account";
  size?: 24 | 28 | 30 | 33;
  /** e.g. a "You" marker. Rendered next to the name, never instead of it. */
  badge?: React.ReactNode;
  /** Second line: a role, an id, a timestamp. Defaults to the handle. */
  detail?: React.ReactNode;
  className?: string;
}) {
  const resolved = person ? personFields(person, name, context) : null;
  const shownName = resolved?.name ?? name;
  const second = detail ?? resolved?.secondary ?? null;
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5", className)}>
      <ActorAvatar id={id} name={shownName} src={src} size={size} />
      <span className="min-w-0">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium">{shownName}</span>
          {badge}
        </span>
        {second ? (
          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
            {second}
          </span>
        ) : null}
      </span>
    </span>
  );
}
