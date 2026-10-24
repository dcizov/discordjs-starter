import { baselineInvitePermissions } from "./permissions";
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
      })
      .default({
        roles: true,
        moderation: true,
        economy: true,
        music: true,
        deals: true,
        news: true,
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
      })
      .default({ djRoleId: "", defaultVolume: 65, maxQueue: 100 }),
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
    adapter: z
      .enum(["rss", "steam", "webhook", "blizzard", "wowhead", "mojang"])
      .default("rss"),
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
export function isDemo() {
  return (
    process.env.DEMO_MODE === "true" ||
    (process.env.NODE_ENV !== "production" &&
      process.env.DEMO_MODE !== "false" &&
      !process.env.DISCORD_CLIENT_ID)
  );
}
export function required(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be configured`);
  return v;
}
export function inviteUrl(guildId?: string) {
  const app = process.env.DISCORD_CLIENT_ID;
  if (!app) return null;
  const permissions = baselineInvitePermissions;
  return `https://discord.com/oauth2/authorize?client_id=${app}&scope=bot%20applications.commands&permissions=${permissions}${guildId ? `&guild_id=${guildId}&disable_guild_select=true` : ""}`;
}
export function validateEnvironment(service: "web" | "bot" | "worker") {
  if (isDemo()) return;
  const common = z
    .object({
      DATABASE_URL: z.string().url(),
      REDIS_URL: z.string().url(),
      DISCORD_TOKEN: z.string().min(1),
    })
    .passthrough();
  const schema =
    service === "web"
      ? common.extend({
          DISCORD_CLIENT_ID: snowflake,
          DISCORD_CLIENT_SECRET: z.string().min(1),
          APP_SECRET: z.string().min(32),
          APP_URL: z
            .string()
            .url()
            .refine((v) => {
              const u = new URL(v);
              return (
                u.protocol === "https:" ||
                u.hostname === "localhost" ||
                u.hostname === "127.0.0.1"
              );
            }, "Use a public HTTPS URL (HTTP localhost is allowed for development)"),
        })
      : service === "bot"
        ? common.extend({ DISCORD_CLIENT_ID: snowflake })
        : common;
  const result = schema.safeParse(process.env);
  if (!result.success)
    throw new Error(
      `Invalid ${service} environment: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
    );
  if (!!process.env.LAVALINK_URL !== !!process.env.LAVALINK_PASSWORD)
    throw new Error(
      "Configure both LAVALINK_URL and LAVALINK_PASSWORD, or leave both empty."
    );
}
