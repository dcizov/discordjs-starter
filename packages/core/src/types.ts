import type { ActivitySnapshot } from "./activity";
import type { GameDeal } from "./deal-types";
export type ModuleKey =
  | "roles"
  | "moderation"
  | "economy"
  | "music"
  | "deals"
  | "news"
  | "polls"
  | "announcements"
  | "xp"
  | "tickets";
export type ResourceKind =
  "panel" | "rule" | "case" | "shop" | "deal" | "source" | "route";
export type Resource = {
  id: string;
  guildId: string;
  kind: ResourceKind;
  name: string;
  enabled: boolean;
  data: Record<string, any>;
  createdAt: string;
  updatedAt: string;
};
export type GuildRole = {
  id: string;
  name: string;
  color: string;
  position: number;
  permissions: string;
  managed: boolean;
  /** Present on new bot syncs; missing legacy/demo data is not a live audit. */
  assignedToBot?: boolean;
};
export type GuildChannel = {
  id: string;
  name: string;
  type: "text" | "voice" | "stage" | "category" | "forum" | "media" | "other";
  canSend: boolean;
  /** Effective bot permissions including channel/category overwrites at sync. */
  permissionBits?: string;
  permissionsSyncedAt?: string;
  /** Orbit currently publishes native polls/announcements only in ordinary guild text channels. */
  supportsCommunityPosts?: boolean;
};
export type GuildConfig = {
  locale: string;
  timezone: string;
  auditChannelId: string;
  notificationRoleId: string;
  modules: Record<ModuleKey, boolean>;
  economy: {
    currency: string;
    symbol: string;
    dailyAmount: number;
    activityAmount: number;
    activityCooldown: number;
    transferEnabled: boolean;
  };
  music: {
    djRoleId: string;
    defaultVolume: number;
    maxQueue: number;
    maxPerMember: number;
    /** Seconds to stay in voice after the queue empties; 0 leaves at once. */
    idleDisconnectSeconds: number;
  };
  moderation: {
    exemptRoleIds: string[];
    escalationThreshold: number;
    escalationMinutes: number;
  };
  /**
   * Leveling. Kept in step with the `xp` section of the config schema by hand,
   * which is a duplication worth knowing about: adding a field means editing
   * both this type and `configSchema`.
   */
  tickets: import("@orbit/core/tickets").TicketConfig;
  xp: {
    messageEnabled: boolean;
    messageMin: number;
    messageMax: number;
    messageCooldownSeconds: number;
    voiceEnabled: boolean;
    voiceMin: number;
    voiceMax: number;
    voiceIntervalSeconds: number;
    voiceMinParticipants: number;
    voiceAllowSelfMute: boolean;
    voiceAllowSelfDeaf: boolean;
    voiceAllowServerMute: boolean;
    voiceAllowServerDeaf: boolean;
    voiceSessionCapMinutes: number;
    ignoreBots: boolean;
    ignoreWebhooks: boolean;
    excludedChannelIds: string[];
    excludedRoleIds: string[];
    announceEnabled: boolean;
    announceChannelId: string;
    announceMessage: string;
    rewards: { level: number; roleId: string }[];
    rewardStack: boolean;
  };
  dashboard: { showHero: boolean; showActivity: boolean; showToolkit: boolean };
};
export type Guild = {
  id: string;
  name: string;
  icon: string | null;
  installed: boolean;
  memberCount: number;
  config: GuildConfig;
  roles: GuildRole[];
  channels: GuildChannel[];
  botRolePosition: number;
  updatedAt: string;
};
export type AuditEntry = {
  id: string;
  guildId: string;
  actorId: string;
  actorName: string;
  /** Avatar hash recorded with the action, if the actor's metadata was known then. */
  actorAvatar?: string | null;
  /** Server-derived display URL for the recorded avatar; never fetched per row. */
  actorAvatarUrl?: string | null;
  action: string;
  target: string;
  /** One-line summary shown in the history table. */
  detail: string;
  /** Full diagnostic (multi-line) revealed on demand; older rows have none. */
  details?: string | null;
  createdAt: string;
};
export type LedgerEntry = {
  id: string;
  guildId: string;
  userId: string;
  counterpartyId: string | null;
  amount: number;
  type: string;
  key: string;
  note: string;
  createdAt: string;
};
/**
 * A Discord guild member as the bot last synchronized them.
 *
 * Deliberately separate from `Account` (an Orbit economy record) and from
 * anything derived from activity: a member who has never earned anything is
 * still a member, and an account whose member left is still an account. The
 * dashboard must never present one dataset as the other.
 */
export type Member = {
  guildId: string;
  userId: string;
  /** Unique Discord handle. */
  username: string | null;
  /** Discord global display name. */
  globalName: string | null;
  /** Guild nickname, when this member has one in this guild. */
  nickname: string | null;
  /** Resolved guild display name, stored at sync time (policy: @orbit/core/identity). */
  displayName: string;
  /** Global avatar hash. */
  avatar: string | null;
  /** Guild-specific avatar hash; preferred over the global one when present. */
  guildAvatar: string | null;
  /** Server-derived display URL: guild avatar, else global avatar, else null. */
  avatarUrl?: string | null;
  bot: boolean;
  joinedAt: string | null;
  /** Role ids held in this guild at the last sync. */
  roles: string[];
  /** False once a *complete* sweep (or a removal event) confirmed the departure. */
  present: boolean;
  departedAt?: string | null;
  syncedAt: string;
};
/**
 * A member exactly as it goes over the wire to the browser.
 *
 * `avatarUrl` is **required** here and optional on `Member`, and that
 * difference is the point of the type.
 *
 * A database row stores avatar *hashes*; turning a hash into a URL is a
 * server-side derivation, so `Member` quite properly has no `avatarUrl`. But
 * the optionality is what let the member directory ship without ever deriving
 * one: the API returned `listMembers()` unchanged, the missing field
 * type-checked, and `IdentityCell` fell back to initials for every row — all
 * 61 of them, including the bot — while the XP leaderboard on the same server
 * showed a real avatar, because that path did derive it.
 *
 * Making it required on the wire type turns that omission into a compile error
 * at the one place that can fix it.
 */
export type MemberWire = Omit<Member, "avatarUrl"> & {
  /** Server-derived: guild avatar, else global avatar, else null. */
  avatarUrl: string | null;
};

/** A page of {@link MemberWire} — the wire form of {@link MembersPage}. */
export type MembersPageWire = Omit<MembersPage, "rows"> & {
  rows: MemberWire[];
};

export type RosterSyncStatus =
  "never" | "running" | "complete" | "partial" | "failed";
/**
 * What the bot knows about its own copy of the roster.
 *
 * `expectedCount` is Discord's `guild.memberCount`, `syncedCount` is how many
 * rows this guild actually holds. They are reported side by side and never
 * merged: a partial sync must not be able to claim it is the whole guild.
 */
export type RosterSync = {
  guildId: string;
  status: RosterSyncStatus;
  startedAt: string | null;
  completedAt: string | null;
  lastAttemptAt: string | null;
  pagesFetched: number;
  syncedCount: number;
  expectedCount: number;
  lastError: string | null;
};
export type MembersPage = {
  rows: Member[];
  total: number;
  page: number;
  pageSize: number;
  sync: RosterSync;
  counts: {
    /** Discord's own number for the guild, as last reported to the bot. */
    guildMemberCount: number;
    /** Rows this guild holds in Orbit's database. */
    syncedMembers: number;
    /** Members with an Orbit economy record — a subset, never the roster. */
    economyAccounts: number;
    bots: number;
    departed: number;
  };
};
export type Account = {
  guildId: string;
  userId: string;
  name: string;
  /** Unique handle and global name, when the roster knows them. */
  username?: string | null;
  globalName?: string | null;
  /**
   * Avatar hash as last captured by the bot when this member earned, spent or
   * received something. Current-ish identity from an already-authorized
   * interaction, not historical evidence and not a per-row API lookup.
   */
  avatar: string | null;
  /** Guild avatar hash, preferred over `avatar` when the roster has one. */
  guildAvatar?: string | null;
  /**
   * Best current guild identity from the synchronized roster, when one exists.
   * The name to display is resolved in the UI by `@orbit/core/identity`, so no
   * surface re-implements the precedence.
   */
  nickname?: string | null;
  /** Server-derived display URL for that hash; null when none was captured. */
  avatarUrl?: string | null;
  balance: number;
  lastDaily: string | null;
};
export type Delivery = {
  id: string;
  guildId: string;
  sourceId: string;
  externalId: string;
  title: string;
  url: string;
  channelId: string;
  status: "pending" | "sending" | "delivered" | "failed";
  attempts: number;
  error: string | null;
  createdAt: string;
  deliveredAt: string | null;
  /** Discord message id, when the send was confirmed. Never invented. */
  messageId?: string | null;
  payload?: Record<string, any>;
};
export type Track = {
  id: string;
  title: string;
  author: string;
  duration: number;
  /** Public track page (provider URL), never an internal stream endpoint. */
  uri: string;
  encoded?: string;
  requestedBy: string;
  requestedById?: string;
  /** Provider source name, e.g. "youtube"; used for failures, never for fetching. */
  source?: string;
  /** Validated public artwork URL supplied by the provider, if any. */
  artwork?: string | null;
};
export type MusicState = {
  tracks: Track[];
  current: Track | null;
  paused: boolean;
  volume: number;
  repeat: "off" | "track" | "queue";
  position: number;
  updatedAt: string;
};
export type ServiceHealth = {
  name: string;
  status: "healthy" | "degraded" | "offline";
  latency: number;
  updatedAt: string;
  detail: string;
};
export type DashboardData = {
  presentation: { referenceAt: string; activity: ActivitySnapshot };
  community?: import("./community").CommunityPage;
  guild: Guild & { iconUrl?: string | null };
  resources: Resource[];
  audit: AuditEntry[];
  ledger: LedgerEntry[];
  accounts: Account[];
  deliveries: Delivery[];
  music: MusicState;
  health: ServiceHealth[];
  demo: boolean;
  stats?: { accountCount: number; circulation: number };
  wallet?: Account | null;
  walletHistory?: {
    rows: LedgerEntry[];
    total: number;
    page: number;
    pageSize: number;
  };
  integrations?: { itad: boolean; lavalink: boolean };
  /**
   * The XP leaderboard's first page. XP rows carry no names; the caller joins
   * them against the synchronized roster, which is why this is separate from
   * `accounts` (which is money, not XP).
   */
  xpBoard?: import("@orbit/db").XpLeaderboard;
  /** Hash fields remain compatible; URL fields are server-derived display data. */
  user: {
    id: string;
    name: string;
    avatar: string | null;
    avatarUrl?: string | null;
    /** Roster identity, when the bot has synchronized this account's member. */
    username?: string | null;
    globalName?: string | null;
    nickname?: string | null;
    /** The handle, when it differs from `name`. Resolved by @orbit/core/identity. */
    secondaryName?: string | null;
  };
  guilds: {
    id: string;
    name: string;
    icon: string | null;
    iconUrl?: string | null;
    installed: boolean;
  }[];
};
/** Attribution inferred from provider metadata; "unknown" is never rendered as official. */
/**
 * `official` = posted on the app's own Steam announcement hub (feed_type 1),
 * `syndicated` = a named third-party feed the app republishes, `unknown` = the
 * provider did not supply enough metadata to tell.
 */
export type NewsAttribution = "official" | "syndicated" | "unknown";
export type FeedItem = {
  id: string;
  title: string;
  url: string;
  summary: string;
  publishedAt: string;
  tags: string[];
  /** Provider-supplied lead image. Never fetched or guessed by Orbit. */
  image?: string | null;
  /**
   * Where `image` came from. `article` is a picture the article itself carried;
   * `app-artwork` is a store image for the game the article is about (a
   * labelled fallback, never presented as article imagery).
   */
  imageKind?: "article" | "app-artwork";
  /** Human-readable credit for a fallback image, e.g. "Dota 2 · Steam store artwork". */
  imageAttribution?: string;
  attribution?: NewsAttribution;
  /** Producer of the item as named by the provider, e.g. "Community Announcements". */
  sourceLabel?: string;
  /** Outlet name when the item is syndicated; empty for app announcements. */
  publisher?: string;
  price?: number;
  currency?: string;
  discount?: number;
  storeId?: number;
  historicalLow?: boolean;
  deal?: GameDeal;
};
export const DEMO_GUILD_ID = "120000000000000001";
export const DEMO_USER_ID = "120000000000000099";

// Original local illustrations only; never substituted for live Discord metadata.
export const DEMO_GUILD_ICON = "/demo/cozy-corner.svg";
export const DEMO_USER_AVATAR = "/demo/jamie-davis.svg";
