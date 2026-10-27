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
    /** Avatar hash recorded when the action happened; never re-fetched per row. */
    actorAvatar: text("actor_avatar"),
    action: text("action").notNull(),
    target: text("target").notNull(),
    /** Bounded one-line summary; the table cell renders this. */
    detail: text("detail").notNull(),
    /** Optional full diagnostic, revealed in the event dialog. */
    details: text("details"),
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
    /*
      Avatar hash captured the last time the bot saw this member earn, spend or
      receive something. Current-ish identity from data the bot already has in
      hand — never fetched per row by the dashboard.
    */
    avatar: text("avatar"),
    /*  Guild-specific avatar hash, preferred over `avatar` when present. */
    guildAvatar: text("guild_avatar"),
    /*  Unique handle and Discord global name, refreshed from the roster. */
    username: text("username"),
    globalName: text("global_name"),
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
/**
 * The guild roster, as the bot last synchronized it.
 *
 * One row per (guild, member). This is the only dataset that may be presented as
 * "the members of this server": economy accounts, audit actors, song requesters
 * and voice participants are all different, smaller things.
 *
 * `present` is the honest flag. It only becomes false when a removal event says
 * so, or when a *complete* paginated sweep finished without seeing the member —
 * never because an attempt failed halfway. A partial roster is therefore
 * representable, and `rosterSync.status` says which one it is.
 */
export const members = pgTable(
  "members",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    username: text("username"),
    globalName: text("global_name"),
    nickname: text("nickname"),
    /** Resolved with one policy (`@orbit/core/identity`), stored for sorting. */
    displayName: text("display_name").notNull(),
    avatar: text("avatar"),
    guildAvatar: text("guild_avatar"),
    bot: boolean("bot").notNull().default(false),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    roles: jsonb("roles").$type<string[]>().notNull().default([]),
    present: boolean("present").notNull().default(true),
    departedAt: timestamp("departed_at", { withTimezone: true }),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.guildId, t.userId] }),
    index("members_guild_name_idx").on(t.guildId, t.displayName),
    index("members_guild_joined_idx").on(t.guildId, t.joinedAt),
    index("members_guild_present_idx").on(t.guildId, t.present),
  ]
);
/**
 * Progress and honesty for one guild's roster copy.
 *
 * Kept in its own row so the dashboard can say "3 of 2,846 members synchronized,
 * last attempt failed" instead of implying an empty guild.
 */
export const rosterSync = pgTable("roster_sync", {
  guildId: text("guild_id")
    .primaryKey()
    .references(() => guilds.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("never"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  pagesFetched: integer("pages_fetched").notNull().default(0),
  syncedCount: integer("synced_count").notNull().default(0),
  expectedCount: integer("expected_count").notNull().default(0),
  lastError: text("last_error"),
});
/**
 * A reusable, portable blueprint of server structure and/or Orbit configuration.
 *
 * Owned by the guild it was captured from. Applying it to another guild is an
 * explicit, previewed, additive operation (see `packages/core/src/templates.ts`);
 * knowing the id of a template never grants access to the guild it came from,
 * because every read is filtered by the authorized target's own source guild.
 */
export const serverTemplates = pgTable(
  "server_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Guild the blueprint was captured from. */
    sourceGuildId: text("source_guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    kind: text("kind").notNull().default("both"),
    /** Schema version of the portable document. */
    version: integer("version").notNull().default(1),
    data: jsonb("data").$type<Record<string, any>>().notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("server_templates_source_idx").on(t.sourceGuildId, t.createdAt)]
);
/**
 * One apply attempt against one target guild.
 *
 * Discord mutations are not a database transaction, so the run row is the
 * record of what actually happened: the validated plan, what was created, what
 * was reused and what failed. It is append-only evidence, not a rollback log.
 */
export const templateRuns = pgTable(
  "template_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    templateId: uuid("template_id")
      .notNull()
      .references(() => serverTemplates.id, { onDelete: "cascade" }),
    actorId: text("actor_id").notNull(),
    state: text("state").notNull().default("queued"),
    plan: jsonb("plan").$type<Record<string, any>>().notNull(),
    result: jsonb("result").$type<Record<string, any>>(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("template_runs_guild_date_idx").on(t.guildId, t.createdAt)]
);
/**
 * What an apply run did, one row per template key.
 *
 * `templateRuns.result` is a flat list rewritten after every step, which is
 * enough to show progress but not enough to resume: it never says which
 * template key produced which Discord id. This table is that mapping, so an
 * interrupted run can pick up where it stopped and reuse exactly the resources
 * the first attempt created rather than guessing by name.
 *
 * `key` is the template's own addressing scheme (`role:moderator`,
 * `channel:general`, `channel:general#overwrites`) and never a Discord id, so
 * the mapping stays meaningful when the template is applied to another server.
 */
export const templateRunSteps = pgTable(
  "template_run_steps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => templateRuns.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    kind: text("kind").notNull(),
    action: text("action").notNull(),
    targetId: text("target_id"),
    state: text("state").notNull().default("pending"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("template_run_steps_run_key_idx").on(t.runId, t.key)]
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
    index("ledger_owner_date_idx").on(t.guildId, t.userId, t.createdAt),
  ]
);
/**
 * Per-member XP totals, guild-scoped and wholly separate from economy
 * currency. A level is a statement about participation; a balance is a
 * statement about a ledger, and the two must never be spendable for each
 * other.
 */
export const xpTotals = pgTable(
  "xp_totals",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    /** Sum of everything ever earned, including admin adjustments. */
    total: bigint("total", { mode: "number" }).notNull().default(0),
    /** How much of `total` came from messages, for the detail view. */
    messageXp: bigint("message_xp", { mode: "number" }).notNull().default(0),
    /** How much of `total` came from voice. */
    voiceXp: bigint("voice_xp", { mode: "number" }).notNull().default(0),
    /** How much came from an operator's adjustment, so it can be told apart. */
    adjustedXp: bigint("adjusted_xp", { mode: "number" }).notNull().default(0),
    /** Last time a message award landed, for the cooldown. */
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    /**
     * Fingerprint of the last counted message, for repetition protection.
     *
     * A hash of the normalised content, never the content itself: the system
     * has no need to keep what anyone said, and keeping it would make the XP
     * tables the most sensitive data in the database. It only ever needs to
     * answer "is this the same message as last time".
     */
    lastMessageHash: text("last_message_hash"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.guildId, t.userId] }),
    // The leaderboard reads this in order on every page load.
    index("xp_totals_board_idx").on(t.guildId, t.total),
  ]
);
/**
 * One row per awarded event, keyed so the same event can never be counted
 * twice.
 *
 * This is what makes awards idempotent: a redelivered gateway event, a retried
 * job or a bot that restarts mid-interval all collide on the same key and lose
 * instead of paying out twice. The unique index is the guarantee, not a check
 * in application code.
 */
export const xpEvents = pgTable(
  "xp_events",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    /** `message:<id>` or `voice:<channelId>:<intervalStart>` or `adjust:<uuid>`. */
    key: text("key").notNull(),
    kind: text("kind").notNull(),
    amount: bigint("amount", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("xp_event_idempotency").on(t.guildId, t.userId, t.key),
    index("xp_events_member_idx").on(t.guildId, t.userId, t.createdAt),
  ]
);
/**
 * Open voice sessions, written so a restart does not lose or invent time.
 *
 * A session is one continuous stay in one channel. Moving channel ends it and
 * starts another, which is what makes "eligible for the whole interval"
 * answerable. `lastIntervalAt` is the start of the interval already paid, so a
 * restart that skipped a minute cannot pay it retroactively — the bot simply
 * resumes from the next whole interval and never credits offline time.
 */
export const xpVoiceSessions = pgTable(
  "xp_voice_sessions",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    channelId: text("channel_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Start of the most recent interval already awarded. */
    lastIntervalAt: timestamp("last_interval_at", { withTimezone: true }),
    /** Since `startedAt`, for the session cap. */
    intervalsAwarded: bigint("intervals_awarded", { mode: "number" })
      .notNull()
      .default(0),
    /**
     * Set when the member stopped being eligible at some sample. Cleared when
     * they become eligible again, so a whole-interval rule can be applied
     * without keeping a per-sample history.
     */
    brokenAt: timestamp("broken_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.guildId, t.userId] })]
);
/**
 * Role rewards already granted.
 *
 * Kept separately from the configuration so a reward is not announced or
 * re-applied twice when an award is retried, and so a reward that failed on
 * permissions can be retried later without losing the fact that it was owed.
 */
export const xpRewardGrants = pgTable(
  "xp_reward_grants",
  {
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    level: bigint("level", { mode: "number" }).notNull(),
    roleId: text("role_id").notNull(),
    /** Null when Discord refused; the row still records that it was owed. */
    grantedAt: timestamp("granted_at", { withTimezone: true }),
    error: text("error"),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.guildId, t.userId, t.level, t.roleId] }),
    index("xp_reward_grants_guild_idx").on(t.guildId, t.userId),
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
    /**
     * Discord's message id, recorded only after the send returned one. Null means
     * "not confirmed", so the dashboard shows no jump link instead of guessing one.
     */
    messageId: text("message_id"),
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

/** Explicit manager-authored content only. Native votes remain on Discord. */
export const communityPosts = pgTable(
  "community_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    guildId: text("guild_id")
      .notNull()
      .references(() => guilds.id, { onDelete: "cascade" }),
    kind: text("kind")
      .$type<import("@orbit/core/community").CommunityKind>()
      .notNull(),
    title: text("title").notNull(),
    channelId: text("channel_id").notNull(),
    body: text("body").notNull().default(""),
    poll: jsonb("poll").$type<import("@orbit/core/community").CommunityPoll>(),
    state: text("state")
      .$type<import("@orbit/core/community").CommunityState>()
      .notNull()
      .default("draft"),
    version: integer("version").notNull().default(1),
    actorId: text("actor_id").notNull(),
    requestKey: text("request_key").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }),
    messageId: text("message_id"),
    lastError: text("last_error"),
    result:
      jsonb("result").$type<import("@orbit/core/community").CommunityResult>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("community_request_key").on(t.guildId, t.requestKey),
    index("community_guild_kind_date_idx").on(t.guildId, t.kind, t.createdAt),
    index("community_due_idx").on(t.state, t.scheduledFor),
    index("community_retention_idx").on(t.updatedAt),
    check("community_kind_valid", sql`${t.kind} in ('poll','announcement')`),
    check(
      "community_state_valid",
      sql`${t.state} in ('draft','scheduled','sending','published','closed','failed','unconfirmed','cancelled','missed')`
    ),
    check("community_version_positive", sql`${t.version}>0`),
  ]
);
