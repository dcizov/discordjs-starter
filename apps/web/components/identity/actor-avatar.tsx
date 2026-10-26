"use client";
import { Orbit } from "lucide-react";
import { IdentityImage } from "./image";

/**
 * One picture for "who did this", used by the audit table, the overview activity
 * list and delivery rows.
 *
 * Three views had their own copy of `actorName === "Orbit" ? glyph : image`, which
 * meant the bot always showed a generic mark even when its real avatar was
 * recorded, and the comparison silently broke for any other system actor. The
 * rules here are:
 *
 * - a **recorded** avatar (`src`) always wins — it is what the actor looked like
 *   when the action happened;
 * - a system/bot actor without a recorded avatar shows the Orbit glyph;
 * - everyone else falls back to initials, which is the honest state for old rows
 *   that never captured an avatar.
 *
 * It never fetches anything: `src` is a server-derived CDN URL.
 */
export function ActorAvatar({
  id,
  name,
  src,
  size = 28,
}: {
  id: string;
  name: string;
  src?: string | null;
  size?: 28 | 30 | 33;
}) {
  if (src)
    return (
      <IdentityImage id={id} name={name} src={src} kind="user" size={size} />
    );
  const system =
    name === "Orbit" || /^orbit[-_]|^system:/.test(id) || id === "orbit-worker";
  if (system)
    return (
      <span
        aria-hidden="true"
        style={{ width: size, height: size }}
        className="flex shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-400 dark:bg-violet-500/10"
      >
        <Orbit size={14} />
      </span>
    );
  return (
    <IdentityImage id={id} name={name} src={null} kind="user" size={size} />
  );
}
