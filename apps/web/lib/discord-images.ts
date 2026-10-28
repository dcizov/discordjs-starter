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
 * Discord's own default avatar — the coloured disc the client shows for an
 * account that has never uploaded one.
 *
 * The index arithmetic is Discord's, not ours, and there are two rules:
 *
 * - New-style accounts (discriminator `0`) derive it from the snowflake:
 *   `Number(BigInt(userId) >> 22n) % 6`.
 * - Legacy accounts with a real discriminator use `discriminator % 5`.
 *
 * Both are lifted from `discord.js`'s own `User#defaultAvatarURL`
 * (`node_modules/discord.js/src/structures/User.js:268`), which delegates the
 * snowflake case to `calculateUserDefaultAvatarIndex` in `@discordjs/rest`.
 * The arithmetic is inlined rather than imported because `@discordjs/rest` is
 * a transitive dependency here, not a declared one, and a two-line function
 * is not worth widening the dependency surface. It is pinned by a test that
 * checks it against `cdn.defaultAvatar()`, which is the same value discord.js
 * itself would return.
 *
 * Note the extension: default avatars are PNG and take no size option, unlike
 * uploaded ones. That is `CDN#defaultAvatar`, not a choice made here.
 */
export function defaultAvatarUrl(
  userId: string,
  discriminator?: string | null
): string | null {
  if (!/^\d{17,20}$/.test(userId)) return null;
  /*
   * Demo ids are shaped like snowflakes but are not Discord accounts, so a
   * default-avatar URL for one would 404 on the real CDN. The seed also
   * deliberately leaves most personas without a bundled illustration, so the
   * initials fallback stays reachable in the demo and nothing is fetched.
   */
  if (isDemo()) return null;
  const legacy =
    discriminator &&
    discriminator !== "0" &&
    discriminator !== "0000" &&
    /^\d{1,4}$/.test(discriminator);
  const index = legacy
    ? Number(discriminator) % 5
    : Number(BigInt(userId) >> 22n) % 6;
  return cdn.defaultAvatar(index);
}

/**
 * The one avatar precedence for people: the guild avatar this server shows,
 * then the account's global avatar, then Discord's own default.
 *
 * The last step is the point. It used to return `null` there, and every
 * member who had never uploaded an avatar — most of a real server, the bot
 * included — was drawn as two initials, while the same person's XP
 * leaderboard row next to it drew a picture. A default avatar is not a guess
 * about what someone looks like; it is the face Discord itself serves for
 * that account, and showing it is more honest than a monogram.
 *
 * `null` now means only one thing: the id is not a Discord snowflake, so no
 * URL can exist for it.
 */
export function personAvatarUrl(input: {
  guildId?: string | null;
  userId: string;
  guildAvatar?: string | null;
  avatar?: string | null;
  discriminator?: string | null;
}): string | null {
  const guild =
    input.guildId && input.guildAvatar
      ? memberAvatarUrl(input.guildId, input.userId, input.guildAvatar)
      : null;
  return (
    guild ??
    userAvatarUrl(input.userId, input.avatar ?? null) ??
    defaultAvatarUrl(input.userId, input.discriminator ?? null)
  );
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
