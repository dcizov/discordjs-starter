import { ActivityType, type PresenceData } from "discord.js";
import { safeText } from "@orbit/core";

/**
 * Bot presence, configured by environment only.
 *
 * Rules that keep this honest and quiet:
 * - it is set once, after the gateway is ready, and never loops (no "watching N
 *   servers" that drifts every few seconds, no rotating ad copy);
 * - the default names a command that really exists (`/help`), not a feature we do
 *   not ship;
 * - a member/server count is never injected automatically, because the dashboard
 *   and the bot can disagree while a shard reconnects;
 * - an empty `BOT_ACTIVITY` turns presence off entirely, so a deployment that
 *   prefers the bare bot name can keep it.
 */
const TYPES: Record<string, ActivityType> = {
  playing: ActivityType.Playing,
  watching: ActivityType.Watching,
  listening: ActivityType.Listening,
  competing: ActivityType.Competing,
};
const STATUSES = new Set(["online", "idle", "dnd", "invisible"]);

export type PresenceSettings = {
  presence: PresenceData | null;
  /** Human-readable note for the startup log; never contains a secret. */
  note: string;
};

export function presenceFromEnv(
  env: Record<string, string | undefined> = process.env
): PresenceSettings {
  const raw = env.BOT_ACTIVITY;
  // Unset means "use the default"; an explicitly empty value means "no presence".
  if (raw === "")
    return {
      presence: null,
      note: "Presence disabled (BOT_ACTIVITY is empty).",
    };
  const name = safeText((raw ?? "/help").trim(), 128) || "/help";
  const typeName = (env.BOT_ACTIVITY_TYPE ?? "watching").trim().toLowerCase();
  const type = TYPES[typeName] ?? ActivityType.Watching;
  const status = (env.BOT_STATUS ?? "online").trim().toLowerCase();
  return {
    presence: {
      status: (STATUSES.has(status)
        ? status
        : "online") as PresenceData["status"],
      activities: [{ name, type }],
    },
    note:
      TYPES[typeName] && STATUSES.has(status)
        ? `Presence set after readiness: ${typeName} “${name}”.`
        : `Presence set after readiness: watching “${name}” (BOT_ACTIVITY_TYPE/BOT_STATUS not recognized, using defaults).`,
  };
}
