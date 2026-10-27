import { z } from "zod";
import { DEAL_QUALITY_DEFAULTS } from "./deal-policy";
import type { GuildConfig } from "./types";
export const snowflake = z
  .string()
  .regex(/^\d{17,20}$/, "Enter a valid Discord ID");
const optionalId = z.union([snowflake, z.literal("")]).default("");
export const configSchema = z
  .object({
    locale: z.enum(["en", "de", "fr", "es"]).default("en"),
    timezone: z
      .string()
      .max(64)
      .refine((v) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }, "Invalid timezone")
      .default("Europe/Berlin"),
    auditChannelId: optionalId,
    notificationRoleId: optionalId,
    modules: z
      .object({
        roles: z.boolean(),
        moderation: z.boolean(),
        economy: z.boolean(),
        music: z.boolean(),
        deals: z.boolean(),
        news: z.boolean(),
        polls: z.boolean().default(false),
        announcements: z.boolean().default(false),
      })
      .default({
        roles: true,
        moderation: true,
        economy: true,
        music: true,
        deals: true,
        news: true,
        polls: false,
        announcements: false,
      }),
    economy: z
      .object({
        currency: z.string().min(1).max(24),
        symbol: z.string().min(1).max(4),
        dailyAmount: z.number().int().min(0).max(100000),
        activityAmount: z.number().int().min(0).max(1000),
        activityCooldown: z.number().int().min(30).max(86400),
        transferEnabled: z.boolean(),
      })
      .default({
        currency: "Stardust",
        symbol: "✦",
        dailyAmount: 250,
        activityAmount: 10,
        activityCooldown: 60,
        transferEnabled: true,
      }),
    music: z
      .object({
        djRoleId: optionalId,
        defaultVolume: z.number().int().min(0).max(100),
        maxQueue: z.number().int().min(1).max(200),
        maxPerMember: z.number().int().min(0).max(50).default(0),
        /**
         * Seconds to stay in voice after the queue empties (0 = leave at once).
         * Covers a finished queue and a failed track alike, so one provider
         * failure does not look like the bot dropping out of the channel.
         */
        idleDisconnectSeconds: z.number().int().min(0).max(1800).default(60),
      })
      .default({
        djRoleId: "",
        defaultVolume: 65,
        maxQueue: 100,
        maxPerMember: 0,
        idleDisconnectSeconds: 60,
      }),
    moderation: z
      .object({
        exemptRoleIds: z.array(snowflake).max(20),
        escalationThreshold: z.number().int().min(1).max(20),
        escalationMinutes: z.number().int().min(1).max(40320),
      })
      .default({
        exemptRoleIds: [],
        escalationThreshold: 3,
        escalationMinutes: 10,
      }),
    dashboard: z
      .object({
        showHero: z.boolean(),
        showActivity: z.boolean(),
        showToolkit: z.boolean(),
      })
      .default({ showHero: true, showActivity: true, showToolkit: true }),
  })
  .strict();
export const defaultConfig: GuildConfig = configSchema.parse({});
const base = z.object({
  name: z.string().trim().min(2).max(80),
  enabled: z.boolean().default(true),
});
export const panelSchema = base.extend({
  data: z.object({
    description: z.string().max(1000).default("Choose your roles below."),
    channelId: optionalId,
    roleIds: z.array(snowflake).min(1).max(25),
    mode: z.enum(["buttons", "select", "reaction"]).default("buttons"),
    selection: z.enum(["single", "multi"]).default("multi"),
    maxRoles: z.number().int().min(1).max(25).default(5),
    prerequisiteIds: z.array(snowflake).max(10).default([]),
    exclusiveRoleIds: z.array(snowflake).max(25).default([]),
    messageId: optionalId,
    emojis: z.array(z.string().min(1).max(80)).max(20).default([]),
  }),
});
export const ruleSchema = base.extend({
  data: z.object({
    type: z.enum(["spam", "repeated", "mentions", "blocked_terms"]),
    threshold: z.number().int().min(1).max(100).default(5),
    windowSeconds: z.number().int().min(2).max(300).default(10),
    action: z.enum(["delete", "warn", "timeout"]).default("warn"),
    durationMinutes: z.number().int().min(1).max(40320).default(10),
    terms: z.array(z.string().min(1).max(100)).max(100).default([]),
    exemptRoleIds: z.array(snowflake).max(20).default([]),
    exemptChannelIds: z.array(snowflake).max(50).default([]),
  }),
});
export const shopSchema = base.extend({
  data: z
    .object({
      description: z.string().max(500).default(""),
      type: z.enum(["role", "item"]).default("role"),
      roleId: optionalId,
      price: z.number().int().min(1).max(100000000),
      stock: z.number().int().min(-1).max(100000).default(-1),
      emoji: z.string().max(8).default("✦"),
    })
    .superRefine((v, c) => {
      if (v.type === "role" && !v.roleId)
        c.addIssue({
          code: "custom",
          message: "Choose a shop role",
          path: ["roleId"],
        });
    }),
});
export const dealSchema = base.extend({
  data: z.object({
    gameId: z.string().uuid().or(z.literal("")).default(""),
    channelId: optionalId,
    region: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .default("DE"),
    currency: z.enum(["EUR", "USD", "GBP", "CAD", "AUD"]).default("EUR"),
    minDiscount: z.number().int().min(0).max(100).default(50),
    maxPrice: z.number().min(0).max(10000).default(60),
    historicalLow: z.boolean().default(false),
    maxPopularityRank: z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(DEAL_QUALITY_DEFAULTS.maxPopularityRank),
    minReviews: z
      .number()
      .int()
      .min(1000)
      .max(10000000)
      .default(DEAL_QUALITY_DEFAULTS.minReviews),
    minScore: z
      .number()
      .int()
      .min(0)
      .max(100)
      .default(DEAL_QUALITY_DEFAULTS.minScore),
    minPlayers: z
      .number()
      .int()
      .min(0)
      .max(10000000)
      .default(DEAL_QUALITY_DEFAULTS.minPlayers),
    maxPostsPerCheck: z
      .number()
      .int()
      .min(1)
      .max(5)
      .default(DEAL_QUALITY_DEFAULTS.maxPostsPerCheck),
    health: z
      .enum(["healthy", "degraded", "setup_required", "paused"])
      .default("setup_required"),
    lastChecked: z.string().optional(),
    lastError: z.string().max(300).optional(),
    stores: z.array(z.number().int().positive()).max(50).default([]),
    notificationRoleId: optionalId,
    intervalMinutes: z.number().int().min(15).max(1440).default(60),
  }),
});
export const sourceSchema = base.extend({
  data: z.object({
    /**
     * Only adapters that actually fetch something belong here.
     *
     * `blizzard`, `wowhead` and `mojang` used to be listed as "bring your own
     * feed" starters, but no fetch path ever existed for them: feeds.ts handles
     * `webhook` and `steam` explicitly and everything else falls through to the
     * RSS/Atom reader, so all three already behaved exactly like `rss`. The
     * only thing the extra values did was imply a provider integration that
     * was never built. Migration 0009 converts stored rows to `rss`.
     */
    adapter: z.enum(["rss", "steam", "webhook"]).default("rss"),
    url: z.string().url().or(z.literal("")).default(""),
    appId: z.number().int().positive().optional(),
    channelId: optionalId,
    keywords: z.array(z.string().min(1).max(80)).max(20).default([]),
    tags: z.array(z.string().min(1).max(30)).max(10).default([]),
    intervalMinutes: z.number().int().min(5).max(1440).default(30),
    notificationRoleId: optionalId,
    embedColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#8b5cf6"),
    includeSummary: z.boolean().default(true),
    /** Steam only: hide items Steam metadata does not attribute to the app. */
    officialOnly: z.boolean().default(false),
    health: z
      .enum(["healthy", "degraded", "setup_required", "paused"])
      .default("setup_required"),
    lastChecked: z.string().optional(),
    lastError: z.string().max(300).optional(),
  }),
});
export const routeSchema = base.extend({
  data: z.object({
    sourceIds: z.array(z.string().uuid()).min(1).max(20),
    channelId: snowflake,
    keywords: z.array(z.string().max(80)).max(20).default([]),
    tags: z.array(z.string().max(30)).max(10).default([]),
    notificationRoleId: optionalId,
    embedColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .default("#8b5cf6"),
    includeSummary: z.boolean().default(true),
  }),
});
export const caseSchema = base.extend({
  data: z.object({
    targetId: snowflake,
    type: z.enum(["warn", "timeout", "kick", "ban", "purge"]),
    reason: z.string().min(1).max(500),
    moderatorId: snowflake,
    durationMinutes: z.number().int().min(1).max(40320).optional(),
    messageCount: z.number().int().min(1).max(100).optional(),
  }),
});
export const resourceSchemas = {
  panel: panelSchema,
  rule: ruleSchema,
  shop: shopSchema,
  deal: dealSchema,
  source: sourceSchema,
  route: routeSchema,
  case: caseSchema,
};
