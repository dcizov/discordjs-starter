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
  | "announcements";
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
  };
  moderation: {
    exemptRoleIds: string[];
    escalationThreshold: number;
    escalationMinutes: number;
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
  detail: string;
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
export type Account = {
  guildId: string;
  userId: string;
  name: string;
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
  payload?: Record<string, any>;
};
export type Track = {
  id: string;
  title: string;
  author: string;
  duration: number;
  uri: string;
  encoded?: string;
  requestedBy: string;
  requestedById?: string;
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
  /** Hash fields remain compatible; URL fields are server-derived display data. */
  user: {
    id: string;
    name: string;
    avatar: string | null;
    avatarUrl?: string | null;
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
