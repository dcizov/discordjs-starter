/**
 * Discord permission bits, as a plain table.
 *
 * This mirrors `PermissionFlagsBits` from discord.js (v14). It is duplicated
 * rather than imported because `packages/core` is bundled into the dashboard:
 * importing discord.js into a client component drags `undici` and
 * `node:async_hooks` into the browser build and fails the webpack compile.
 * The bot continues to use discord.js directly; only the shared, pure modules
 * read this table.
 *
 * `tests/permission-bits.test.ts` asserts this table still matches discord.js,
 * so an upstream rename or a new bit is caught as a test failure rather than
 * silently drifting.
 */
export const PERMISSION_BITS: Record<string, bigint> = {
  CreateInstantInvite: 1n,
  KickMembers: 2n,
  BanMembers: 4n,
  Administrator: 8n,
  ManageChannels: 16n,
  ManageGuild: 32n,
  AddReactions: 64n,
  ViewAuditLog: 128n,
  PrioritySpeaker: 256n,
  Stream: 512n,
  ViewChannel: 1024n,
  SendMessages: 2048n,
  SendTTSMessages: 4096n,
  ManageMessages: 8192n,
  EmbedLinks: 16384n,
  AttachFiles: 32768n,
  ReadMessageHistory: 65536n,
  MentionEveryone: 131072n,
  UseExternalEmojis: 262144n,
  ViewGuildInsights: 524288n,
  Connect: 1048576n,
  Speak: 2097152n,
  MuteMembers: 4194304n,
  DeafenMembers: 8388608n,
  MoveMembers: 16777216n,
  UseVAD: 33554432n,
  ChangeNickname: 67108864n,
  ManageNicknames: 134217728n,
  ManageRoles: 268435456n,
  ManageWebhooks: 536870912n,
  ManageEmojisAndStickers: 1073741824n,
  ManageGuildExpressions: 1073741824n,
  UseApplicationCommands: 2147483648n,
  RequestToSpeak: 4294967296n,
  ManageEvents: 8589934592n,
  ManageThreads: 17179869184n,
  CreatePublicThreads: 34359738368n,
  CreatePrivateThreads: 68719476736n,
  UseExternalStickers: 137438953472n,
  SendMessagesInThreads: 274877906944n,
  UseEmbeddedActivities: 549755813888n,
  ModerateMembers: 1099511627776n,
  ViewCreatorMonetizationAnalytics: 2199023255552n,
  UseSoundboard: 4398046511104n,
  CreateGuildExpressions: 8796093022208n,
  CreateEvents: 17592186044416n,
  UseExternalSounds: 35184372088832n,
  SendVoiceMessages: 70368744177664n,
  SetVoiceChannelStatus: 281474976710656n,
  SendPolls: 562949953421312n,
  UseExternalApps: 1125899906842624n,
  PinMessages: 2251799813685248n,
  BypassSlowmode: 4503599627370496n,
} as const;

/** Look up a single permission by name; `undefined` if Discord has no such bit. */
export function permissionBit(name: string): bigint | undefined {
  return PERMISSION_BITS[name];
}
