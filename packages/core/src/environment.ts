import { z } from "zod";
import { baselineInvitePermissions } from "./permissions";

type Environment = Readonly<Record<string, string | undefined>>;

// Server runtime contracts only: deliberately not exported by @orbit/core's
// browser-facing barrel. Values are read on use, not captured during a build.
const fields = {
  DATABASE_URL: z
    .url()
    .refine(
      (v) =>
        URL.canParse(v) &&
        ["postgres:", "postgresql:"].includes(new URL(v).protocol),
      "Use a PostgreSQL URL"
    ),
  REDIS_URL: z
    .url()
    .refine(
      (v) =>
        URL.canParse(v) && ["redis:", "rediss:"].includes(new URL(v).protocol),
      "Use a Redis URL"
    ),
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().regex(/^\d{17,20}$/),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  APP_SECRET: z.string().min(32),
  APP_URL: z.url().refine((v) => {
    if (!URL.canParse(v)) return false;
    const u = new URL(v);
    return (
      !u.username &&
      !u.password &&
      (u.protocol === "https:" ||
        (u.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(u.hostname)))
    );
  }, "Use public HTTPS or HTTP localhost without URL credentials"),
  LAVALINK_URL: z
    .string()
    .min(1)
    .refine((v) => {
      try {
        const u = new URL(`http://${v}`);
        return (
          !v.includes("://") &&
          !!u.hostname &&
          !!u.port &&
          !u.username &&
          !u.password &&
          u.pathname === "/" &&
          !u.search &&
          !u.hash
        );
      } catch {
        return false;
      }
    }, "Use hostname:port without a scheme or credentials"),
  LAVALINK_PASSWORD: z.string().min(1),
  ITAD_API_KEY: z.string().min(1),
};
const connections = {
  DATABASE_URL: fields.DATABASE_URL,
  REDIS_URL: fields.REDIS_URL,
  DISCORD_TOKEN: fields.DISCORD_TOKEN,
};
const optionalMusic = {
  LAVALINK_URL: fields.LAVALINK_URL.optional(),
  LAVALINK_PASSWORD: fields.LAVALINK_PASSWORD.optional(),
  LAVALINK_SECURE: z.enum(["true", "false"]).optional(),
};
const runtimes = {
  web: z.object({
    ...connections,
    DISCORD_CLIENT_ID: fields.DISCORD_CLIENT_ID,
    DISCORD_CLIENT_SECRET: fields.DISCORD_CLIENT_SECRET,
    APP_URL: fields.APP_URL,
    APP_SECRET: fields.APP_SECRET,
  }),
  bot: z
    .object({
      ...connections,
      DISCORD_CLIENT_ID: fields.DISCORD_CLIENT_ID,
      ...optionalMusic,
    })
    .refine((v) => !!v.LAVALINK_URL === !!v.LAVALINK_PASSWORD, {
      path: ["LAVALINK_URL"],
      message:
        "Configure both LAVALINK_URL and LAVALINK_PASSWORD, or leave both empty",
    }),
  worker: z.object(connections),
  register: z.object({
    DISCORD_TOKEN: fields.DISCORD_TOKEN,
    DISCORD_CLIENT_ID: fields.DISCORD_CLIENT_ID,
    DISCORD_GUILD_ID: fields.DISCORD_CLIENT_ID.optional(),
  }),
  export: z.object({ DISCORD_TOKEN: fields.DISCORD_TOKEN }),
  migrate: z.object({ DATABASE_URL: fields.DATABASE_URL }),
  "music-doctor": z.object({
    LAVALINK_URL: fields.LAVALINK_URL,
    LAVALINK_PASSWORD: fields.LAVALINK_PASSWORD,
    LAVALINK_SECURE: optionalMusic.LAVALINK_SECURE,
  }),
};
export type Runtime = keyof typeof runtimes;
function assertServer() {
  if (typeof window !== "undefined")
    throw new Error("Environment credentials can only be read on the server");
}
export function isDemo(source: Environment = process.env) {
  const mode = source.DEMO_MODE || undefined;
  if (mode !== undefined && mode !== "true" && mode !== "false")
    throw new Error("DEMO_MODE must be true or false");
  return (
    mode === "true" ||
    (source.NODE_ENV !== "production" &&
      mode !== "false" &&
      !source.DISCORD_CLIENT_ID)
  );
}
/** Typed individual reads use exactly the same validators as service startup. */
export function required(
  name: keyof typeof fields,
  source: Environment = process.env
): string {
  assertServer();
  const result = fields[name].safeParse(source[name]);
  if (!result.success)
    throw new Error(`${name} must be configured with a valid value`);
  return result.data;
}
export function validateEnvironment(
  service: Runtime,
  source: Environment = process.env
): void {
  assertServer();
  // Compiling modules never calls this function. Explicit demo services have no
  // live dependencies; one-shot data/diagnostic tools still validate what they use.
  if (["web", "bot", "worker", "register"].includes(service) && isDemo(source))
    return;
  const normalized = Object.fromEntries(
    Object.entries(source).map(([key, value]) => [
      key,
      value === "" ? undefined : value,
    ])
  );
  const result = runtimes[service].safeParse(normalized);
  if (!result.success)
    throw new Error(
      `Invalid ${service} environment: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`
    );
}
export function inviteUrl(guildId?: string) {
  const app = process.env.DISCORD_CLIENT_ID;
  if (!app || !fields.DISCORD_CLIENT_ID.safeParse(app).success) return null;
  return `https://discord.com/oauth2/authorize?client_id=${app}&scope=bot%20applications.commands&permissions=${baselineInvitePermissions}${guildId ? `&guild_id=${guildId}&disable_guild_select=true` : ""}`;
}
