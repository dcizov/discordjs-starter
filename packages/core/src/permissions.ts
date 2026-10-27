/** Browser-safe policy shared by setup UI and server enforcement. No credentials or Discord REST calls. */
import type { GuildChannel, GuildRole } from "./types";
export const Permissions = {
  ViewChannel: 1024n,
  SendMessages: 2048n,
  EmbedLinks: 16384n,
  ReadMessageHistory: 65536n,
  AddReactions: 64n,
  UseExternalEmojis: 262144n,
  Connect: 1048576n,
  Speak: 2097152n,
  SendPolls: 562949953421312n,
  Administrator: 8n,
  ManageGuild: 32n,
  ManageRoles: 268435456n,
  ManageChannels: 16n,
  KickMembers: 2n,
  BanMembers: 4n,
  ModerateMembers: 1099511627776n,
  ManageMessages: 8192n,
  MentionEveryone: 131072n,
  ManageWebhooks: 536870912n,
  ManageNicknames: 134217728n,
  ManageExpressions: 1073741824n,
  ManageEvents: 8589934592n,
  ManageThreads: 17179869184n,
  MuteMembers: 4194304n,
  DeafenMembers: 8388608n,
  MoveMembers: 16777216n,
  ViewAuditLog: 128n,
  ViewGuildInsights: 524288n,
  ViewCreatorMonetizationAnalytics: 2199023255552n,
  CreateGuildExpressions: 8796093022208n,
  CreateEvents: 17592186044416n,
  PinMessages: 2251799813685248n,
  BypassSlowmode: 4503599627370496n,
};
// Audited against the union of discord.js 14.27 PermissionFlagsBits; tests prevent drift.
// Preserve unknown raw bits for exports, but fail CLOSED for self-assignment.
export const knownDiscordPermissionMask = 8866461766385663n;
export type PermissionName = keyof typeof Permissions;
const elevated: PermissionName[] = [
  "Administrator",
  "ManageGuild",
  "ManageRoles",
  "ManageChannels",
  "KickMembers",
  "BanMembers",
  "ModerateMembers",
  "ManageMessages",
  "MentionEveryone",
  "ManageWebhooks",
  "ManageNicknames",
  "ManageExpressions",
  "ManageEvents",
  "ManageThreads",
  "MuteMembers",
  "DeafenMembers",
  "MoveMembers",
  "ViewAuditLog",
  "ViewGuildInsights",
  "ViewCreatorMonetizationAnalytics",
  "CreateGuildExpressions",
  "CreateEvents",
  "PinMessages",
  "BypassSlowmode",
];
export const elevatedRoleMask = elevated.reduce(
  (mask, name) => mask | Permissions[name],
  0n
);
export function roleAssignmentIssue(
  role: GuildRole | undefined,
  botPosition: number,
  guildId: string
): string | null {
  if (!role) return "This role no longer exists.";
  if (role.id === guildId || role.managed)
    return "Managed roles and @everyone cannot be self-assigned.";
  if (role.position >= botPosition)
    return "Move the Orbit role above the roles it manages.";
  try {
    if (!/^\d+$/.test(role.permissions))
      return "Role permissions are not available; wait for a guild sync.";
    if ((BigInt(role.permissions) & ~knownDiscordPermissionMask) !== 0n)
      return "Roles with unrecognized permission bits cannot be self-assigned; update and audit the permission policy first.";
    if ((BigInt(role.permissions) & elevatedRoleMask) !== 0n)
      return "Roles with elevated permissions cannot be self-assigned.";
  } catch {
    return "Role permissions are not available; wait for a guild sync.";
  }
  return null;
}
export function permissionState(
  bits: string | undefined,
  required: readonly PermissionName[]
): "present" | "missing" | "unknown" {
  if (bits === undefined || !/^\d+$/.test(bits)) return "unknown";
  const value = BigInt(bits);
  return (value & Permissions.Administrator) !== 0n ||
    required.every((name) => (value & Permissions[name]) === Permissions[name])
    ? "present"
    : "missing";
}
export function botGuildPermissions(roles: GuildRole[]) {
  if (
    !roles.length ||
    roles.some(
      (role) =>
        role.assignedToBot === undefined || !/^\d+$/.test(role.permissions)
    )
  )
    return undefined;
  return roles
    .filter((role) => role.assignedToBot)
    .reduce((mask, role) => mask | BigInt(role.permissions), 0n)
    .toString();
}
// Basic channel posting only. Moderation, role management and voice are opt-in
// Discord grants, not silently requested by a one-size-fits-all invite.
export const baselineInvitePermissions = (
  Permissions.ViewChannel |
  Permissions.SendMessages |
  Permissions.EmbedLinks
).toString();
export const gatewayIntentNames = [
  "Guilds",
  "GuildMembers",
  "GuildMessages",
  "MessageContent",
  "GuildMessageReactions",
  "GuildVoiceStates",
] as const;
export const permissionMatrix: Array<{
  key: string;
  title: string;
  module?: import("./types").ModuleKey;
  scope: "channel" | "guild";
  channelType?: GuildChannel["type"];
  required: PermissionName[];
  condition: string;
  failure: string;
}> = [
  {
    key: "native-polls",
    title: "Native poll publication",
    module: "polls",
    scope: "channel",
    channelType: "text",
    required: ["ViewChannel", "SendMessages", "SendPolls"],
    condition:
      "Opt-in only; ordinary server text channels in this Orbit release. Fresh Manage Server and manager channel visibility are required. No voter-list collection or poll-vote intent.",
    failure:
      "Publication is blocked. Grant Send Polls only in the selected poll destination; the default invite mask is unchanged.",
  },
  {
    key: "native-poll-results",
    title: "Native poll refresh / early close",
    module: "polls",
    scope: "channel",
    channelType: "text",
    required: ["ViewChannel", "ReadMessageHistory"],
    condition:
      "Only Orbit-owned poll messages. A current manager may refresh/end a poll while the module is paused. Counts are unknown when Discord omits results.",
    failure:
      "The saved poll cannot be read or ended. Deleted messages are not replaced automatically.",
  },
  {
    key: "announcements",
    title: "One-time announcements",
    module: "announcements",
    scope: "channel",
    channelType: "text",
    required: ["ViewChannel", "SendMessages", "EmbedLinks"],
    condition:
      "Opt-in only; no webhook/crosspost/role ping. A scheduled approver must still be a manager at send time. Paused/expired/stale jobs cannot publish.",
    failure:
      "No new publication. Missed schedules expire after a 15-minute grace window, never a catch-up flood.",
  },
  {
    key: "posting",
    title: "Baseline channel posting",
    scope: "channel",
    channelType: "text",
    required: ["ViewChannel", "SendMessages", "EmbedLinks"],
    condition:
      "Publishing embeds; slash-command replies are interaction webhooks, not this posting check.",
    failure: "Cannot publish panels, audit embeds or feed messages here.",
  },
  {
    key: "self-roles",
    title: "Self-role changes / shop roles",
    module: "roles",
    scope: "guild",
    required: ["ManageRoles"],
    condition:
      "Safe roles below Orbit only; role-shop entitlements use the same policy. Panel publishing also needs posting access.",
    failure:
      "Assignment/claim fails. Move Orbit above the selected safe role; never make protected roles self-assignable.",
  },
  {
    key: "panel-refresh",
    title: "Refresh an existing panel",
    module: "roles",
    scope: "channel",
    channelType: "text",
    required: ["ViewChannel", "ReadMessageHistory"],
    condition:
      "Fetching the saved panel message for editing; posting rights still apply. Not required for a new embed or ordinary interaction reply.",
    failure:
      "The saved message cannot be fetched, so publishing may create a replacement instead of editing it.",
  },
  {
    key: "reactions",
    title: "Reaction role panels",
    module: "roles",
    scope: "channel",
    channelType: "text",
    required: ["ViewChannel", "ReadMessageHistory", "AddReactions"],
    condition:
      "Reaction mode only; external custom emoji may additionally need UseExternalEmojis. Buttons/selects do not need AddReactions.",
    failure:
      "Cannot fetch an older panel or seed its reactions. ManageMessages is only optional cleanup of a rejected user's reaction.",
  },
  {
    key: "warnings",
    title: "Warnings / timeout",
    module: "moderation",
    scope: "guild",
    required: ["ModerateMembers"],
    condition:
      "Current warn AND timeout code requires this for Orbit and moderator; hierarchy applies. Timeout cannot target administrators.",
    failure:
      "Warning/timeout is rejected; channel overwrites do not grant guild moderation authority.",
  },
  {
    key: "kick",
    title: "Kick",
    module: "moderation",
    scope: "guild",
    required: ["KickMembers"],
    condition: "Only if kick is used; actor and Orbit must outrank the target.",
    failure: "Kick is rejected.",
  },
  {
    key: "ban",
    title: "Ban",
    module: "moderation",
    scope: "guild",
    required: ["BanMembers"],
    condition: "Only if ban is used; actor and Orbit must outrank the target.",
    failure: "Ban is rejected.",
  },
  {
    key: "purge",
    title: "Purge / automod deletion",
    module: "moderation",
    scope: "channel",
    channelType: "text",
    required: ["ViewChannel", "ManageMessages", "ReadMessageHistory"],
    condition:
      "Purge fetches recent history; automod deletion needs ManageMessages, and warn/timeout actions also need ModerateMembers. Purge skips messages ≥14 days old.",
    failure:
      "Cannot bulk-delete messages here; missing permissions do not bypass rule/target protections.",
  },
  {
    key: "activity",
    title: "Economy activity rewards",
    module: "economy",
    scope: "channel",
    channelType: "text",
    required: ["ViewChannel"],
    condition:
      "Qualifying non-bot messages, MessageContent intent, reward >0 and cooldown. Daily/transfer/item purchases need no moderation/role/voice grants.",
    failure:
      "No qualifying visible message means no activity reward; currency transactions remain guild-scoped and atomic.",
  },
  {
    key: "voice",
    title: "Music voice join",
    module: "music",
    scope: "channel",
    channelType: "voice",
    required: ["ViewChannel", "Connect", "Speak"],
    condition:
      "Normal non-full voice channel; GuildVoiceStates in code, same-channel/DJ guards and separate Lavalink/source readiness. Stage is unsupported. MoveMembers is NOT a normal requirement.",
    failure:
      "Join is refused. Fix selected-channel/category overwrites; source/plugin changes cannot repair missing gateway events.",
  },
  {
    key: "deals",
    title: "Scheduled game deals",
    module: "deals",
    scope: "channel",
    channelType: "text",
    required: ["ViewChannel", "SendMessages", "EmbedLinks"],
    condition:
      "Configured ITAD key, enabled subscription, supported text destination and running worker. Only explicitly configured role mentions are allowed.",
    failure:
      "Delivery fails/retries. A role ping needs a mentionable role OR conditional MentionEveryone; do not grant it globally by default.",
  },
  {
    key: "news",
    title: "News / signed-webhook routes",
    module: "news",
    scope: "channel",
    channelType: "text",
    required: ["ViewChannel", "SendMessages", "EmbedLinks"],
    condition:
      "Enabled, configured Steam/RSS/Atom/signed-webhook source with a direct destination OR matching route. A source without a verified feed URL stays setup-required until configured.",
    failure:
      "No automatic delivery without a source and direct destination or matching route. Inbound signed webhooks do NOT need Discord ManageWebhooks.",
  },
];
