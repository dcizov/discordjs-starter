import type {
  GuildChannel,
  GuildConfig,
  GuildRole,
  MusicState,
} from "@orbit/core";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
export const guilds = pgTable("guilds", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  icon: text("icon"),
  installed: boolean("installed").notNull().default(true),
  memberCount: integer("member_count").notNull().default(0),
  config: jsonb("config").$type<GuildConfig>().notNull(),
  roles: jsonb("roles").$type<GuildRole[]>().notNull().default([]),
  channels: jsonb("channels").$type<GuildChannel[]>().notNull().default([]),
  botRolePosition: integer("bot_role_position").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const resources = pgTable(
  "resources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    data: jsonb("data").$type<Record<string, any>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("resources_guild_kind_idx").on(t.guildId, t.kind)]
);
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    actorId: text("actor_id").notNull(),
    actorName: text("actor_name").notNull(),
    action: text("action").notNull(),
    target: text("target").notNull(),
    detail: text("detail").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("audit_guild_date_idx").on(t.guildId, t.createdAt)]
);
export const accounts = pgTable(
  "accounts",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    balance: bigint("balance", { mode: "number" }).notNull().default(0),
    lastDaily: timestamp("last_daily", { withTimezone: true }),
    lastActivity: timestamp("last_activity", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.guildId, t.userId] }),
    check(
      "nonnegative_balance",
      sql`${t.balance} >= 0 AND ${t.balance} <= 9000000000000`
    ),
  ]
);
export const economyOperations = pgTable(
  "economy_operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    payload: text("payload").notNull(),
    result: jsonb("result").$type<Record<string, any>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("economy_operation_key").on(t.guildId, t.key)]
);
export const ledger = pgTable(
  "ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    counterpartyId: text("counterparty_id"),
    amount: bigint("amount", { mode: "number" }).notNull(),
    type: text("type").notNull(),
    key: text("key").notNull(),
    note: text("note").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("ledger_idempotency").on(t.guildId, t.userId, t.key),
    index("ledger_guild_date_idx").on(t.guildId, t.createdAt),
  ]
);
export const inventory = pgTable(
  "inventory",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    resourceId: uuid("resource_id").notNull(),
    quantity: integer("quantity").notNull().default(1),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.userId, t.resourceId] })]
);
export const deliveries = pgTable(
  "deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    sourceId: text("source_id").notNull(),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    channelId: text("channel_id").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, any>>()
      .notNull()
      .default({}),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("delivery_deduplication").on(
      t.guildId,
      t.sourceId,
      t.externalId,
      t.channelId
    ),
    index("delivery_guild_date_idx").on(t.guildId, t.createdAt),
  ]
);
export const musicStates = pgTable("music_states", {
  guildId: text("guild_id")
    .primaryKey()
    .references(() => guilds.id, { onDelete: "cascade" }),
  data: jsonb("data").$type<MusicState>().notNull(),
});
export const health = pgTable("service_health", {
  name: text("name").primaryKey(),
  status: text("status").notNull(),
  latency: integer("latency").notNull().default(0),
  detail: text("detail").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    avatar: text("avatar"),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token").notNull(),
    tokenExpiresAt: timestamp("token_expires_at", {
      withTimezone: true,
    }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("sessions_expiry_idx").on(t.expiresAt)]
);
export const webhookSecrets = pgTable("webhook_secrets", {
  sourceId: uuid("source_id")
    .primaryKey()
    .references(() => resources.id, { onDelete: "cascade" }),
  guildId: text("guild_id")
    .notNull()
    .references(() => guilds.id, { onDelete: "cascade" }),
  secret: text("secret").notNull(),
});
