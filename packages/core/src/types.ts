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
  guild: Guild;
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
  user: { id: string; name: string; avatar: string | null };
  guilds: {
    id: string;
    name: string;
    icon: string | null;
    installed: boolean;
  }[];
};
export type FeedItem = {
  id: string;
  title: string;
  url: string;
  summary: string;
  publishedAt: string;
  tags: string[];
  price?: number;
  currency?: string;
  discount?: number;
  storeId?: number;
  historicalLow?: boolean;
  deal?: GameDeal;
};
export const DEMO_GUILD_ID = "120000000000000001";
export const DEMO_USER_ID = "120000000000000099";
