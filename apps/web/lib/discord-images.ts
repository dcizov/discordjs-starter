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
export function userAvatarUrl(id: string, avatar: string | null) {
  // Only the bundled, original demo illustrations bypass the Discord CDN.
  if (isDemo() && avatar && /^\/demo\/[a-z0-9-]+\.svg$/.test(avatar))
    return avatar;
  return validImage(id, avatar) ? cdn.avatar(id, avatar, options) : null;
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
