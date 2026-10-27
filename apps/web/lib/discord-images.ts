import "server-only";
import { CDN } from "discord.js";
import { DEMO_GUILD_ICON } from "@orbit/core";
import { isDemo } from "@orbit/core/environment";
import type { DashboardData } from "@orbit/core";

const cdn = new CDN();
const options = { size: 128, extension: "webp", forceStatic: true } as const;
function validImage(id: string, hash: string | null): hash is string {
  return (
    /^\d{17,20}$/.test(id) && !!hash && /^(?:a_)?[a-f0-9]{32}$/i.test(hash)
  );
}
export function guildIconUrl(id: string, icon: string | null) {
  if (isDemo() && icon === DEMO_GUILD_ICON) return icon;
  return validImage(id, icon) ? cdn.icon(id, icon, options) : null;
}
const DEMO_AVATAR = /^\/demo\/[a-z0-9-]+\.svg$/;

/** Only the bundled, original demo illustrations bypass the Discord CDN. */
function demoAvatar(hash: string | null) {
  return isDemo() && hash && DEMO_AVATAR.test(hash) ? hash : null;
}

export function userAvatarUrl(id: string, avatar: string | null) {
  const demo = demoAvatar(avatar);
  if (demo) return demo;
  return validImage(id, avatar) ? cdn.avatar(id, avatar, options) : null;
}

/**
 * Guild-specific member avatar.
 *
 * Discord stores this separately from the global avatar
 * (`/guilds/{guild}/users/{user}/avatars/{hash}`), so it needs its own URL
 * builder — passing its hash to the global builder produces a URL that 404s.
 */
export function memberAvatarUrl(
  guildId: string,
  userId: string,
  guildAvatar: string | null
) {
  const demo = demoAvatar(guildAvatar);
  if (demo) return demo;
  const ids = /^\d{17,20}$/.test(guildId) && /^\d{17,20}$/.test(userId);
  const hash = !!guildAvatar && /^(?:a_)?[a-f0-9]{32}$/i.test(guildAvatar);
  return ids && hash
    ? cdn.guildMemberAvatar(guildId, userId, guildAvatar, options)
    : null;
}

/**
 * The one avatar precedence for people: the guild avatar this server shows,
 * then the account's global avatar, then nothing. A `null` is honest — the
 * component says so instead of drawing a face that does not exist.
 */
export function personAvatarUrl(input: {
  guildId?: string | null;
  userId: string;
  guildAvatar?: string | null;
  avatar?: string | null;
}) {
  const guild =
    input.guildId && input.guildAvatar
      ? memberAvatarUrl(input.guildId, input.userId, input.guildAvatar)
      : null;
  return guild ?? userAvatarUrl(input.userId, input.avatar ?? null);
}
/** Deliberate public projection: never spread a server-side session identity. */
export function publicUser(
  user: Pick<DashboardData["user"], "id" | "name" | "avatar">
): DashboardData["user"] {
  return {
    id: user.id,
    name: user.name,
    avatar: user.avatar,
    avatarUrl: userAvatarUrl(user.id, user.avatar),
  };
}
