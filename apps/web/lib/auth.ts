import {
  canManageGuild,
  decrypt,
  DEMO_USER_ID,
  DEMO_USER_AVATAR,
  encrypt,
} from "@orbit/core";
import { isDemo, required } from "@orbit/core/environment";
import { database, listInstalledGuilds, schema } from "@orbit/db";
import {
  createDiscordPermissionState,
  DiscordPermissionClient,
  isDiscordPermissionError,
  type DiscordPermissionState,
} from "@orbit/core/discord-permissions";
import { logger } from "@orbit/core/logger";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import "server-only";
import { z } from "zod";

const tokenSchema = z.object({
  access_token: z.string().min(1).max(4096),
  refresh_token: z.string().min(1).max(4096),
  expires_in: z.number().int().positive().max(31_536_000),
});
const profileSchema = z.object({
  id: z.string().regex(/^\d{17,20}$/),
  username: z.string().min(1).max(100),
  global_name: z.string().min(1).max(100).nullable().optional(),
  avatar: z.string().max(128).nullable(),
});
type TokenGrant =
  | { grant_type: "authorization_code"; code: string; redirect_uri: string }
  | { grant_type: "refresh_token"; refresh_token: string };

export async function exchangeDiscordToken(grant: TokenGrant) {
  const response = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: required("DISCORD_CLIENT_ID"),
      client_secret: required("DISCORD_CLIENT_SECRET"),
      ...grant,
    }),
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  }).catch(() => {
    throw new HttpError(
      503,
      "Discord is temporarily unavailable. Try again shortly."
    );
  });
  if (!response.ok)
    throw new HttpError(
      [400, 401, 403].includes(response.status) ? 401 : 503,
      grant.grant_type === "authorization_code"
        ? "Discord could not complete sign-in. Start sign-in again."
        : "Discord could not renew this sign-in. Try again or sign in again."
    );
  const parsed = tokenSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success)
    throw new HttpError(503, "Discord returned invalid session data.");
  return parsed.data;
}
export async function fetchDiscordProfile(accessToken: string) {
  const response = await fetch("https://discord.com/api/v10/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  }).catch(() => {
    throw new HttpError(
      503,
      "Discord is temporarily unavailable. Try again shortly."
    );
  });
  if (!response.ok)
    throw new HttpError(
      [401, 403].includes(response.status) ? 401 : 503,
      "Discord could not load your profile. Try again or sign in again."
    );
  const parsed = profileSchema.safeParse(
    await response.json().catch(() => null)
  );
  if (!parsed.success)
    throw new HttpError(503, "Discord returned invalid profile data.");
  return parsed.data;
}
function profileDetails(user: z.infer<typeof profileSchema>) {
  return { name: user.global_name ?? user.username, avatar: user.avatar };
}
export type Identity = {
  id: string;
  name: string;
  avatar: string | null;
  sessionId?: string;
  accessToken?: string;
};
export const hash = (v: string) => createHash("sha256").update(v).digest("hex");
export async function identity(): Promise<Identity | null> {
  if (isDemo())
    return { id: DEMO_USER_ID, name: "Jamie Davis", avatar: DEMO_USER_AVATAR };
  const token = (await cookies()).get("orbit_session")?.value;
  if (!token) return null;
  const db = database().db;
  const [s] = await db
    .select()
    .from(schema.sessions)
    .where(
      and(
        eq(schema.sessions.id, hash(token)),
        gt(schema.sessions.expiresAt, new Date())
      )
    );
  if (!s) return null;
  let access = decrypt(s.accessToken, required("APP_SECRET"));
  if (s.tokenExpiresAt.getTime() < Date.now() + 60000) {
    let t: z.infer<typeof tokenSchema>;
    try {
      t = await exchangeDiscordToken({
        grant_type: "refresh_token",
        refresh_token: decrypt(s.refreshToken, required("APP_SECRET")),
      });
    } catch (error) {
      if (error instanceof HttpError && error.status === 401) return null;
      throw error;
    }
    access = t.access_token;
    await db
      .update(schema.sessions)
      .set({
        accessToken: encrypt(access, required("APP_SECRET")),
        refreshToken: encrypt(t.refresh_token, required("APP_SECRET")),
        tokenExpiresAt: new Date(Date.now() + t.expires_in * 1000),
      })
      .where(eq(schema.sessions.id, s.id));
  }
  return {
    id: s.userId,
    name: s.name,
    avatar: s.avatar,
    sessionId: s.id,
    accessToken: access,
  };
}
// Share data and in-flight requests between RSC/API bundles and Next dev reloads.
// No tokens are retained in these keys or successful response snapshots.
const globalAuth = globalThis as typeof globalThis & {
  orbitDiscordPermissionsV1?: DiscordPermissionState;
};
const permissions = new DiscordPermissionClient({
  state: (globalAuth.orbitDiscordPermissionsV1 ??=
    createDiscordPermissionState()),
  onFailure: (info) =>
    logger.warn(info, "Discord guild-permission lookup failed"),
});
export async function manageableGuilds(user: Identity, fresh = false) {
  const installed = await listInstalledGuilds();
  if (isDemo())
    return installed.map((g) => ({
      id: g.id,
      name: g.name,
      icon: g.icon,
      installed: g.installed,
    }));
  if (!user.sessionId || !user.accessToken)
    throw new HttpError(401, "Sign in with Discord to continue");
  let guilds;
  try {
    guilds = await permissions.guilds(user.sessionId, user.accessToken, fresh);
  } catch (error) {
    if (isDiscordPermissionError(error))
      throw new HttpError(error.status, error.message, error.retryAfterSeconds);
    throw error;
  }
  return guilds.filter(canManageGuild).map((g) => ({
    id: g.id,
    name: g.name,
    icon: g.icon ?? null,
    installed: installed.some((i) => i.id === g.id && i.installed),
  }));
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryAfterSeconds?: number
  ) {
    super(message);
  }
}
export async function authorize(guildId: string, mutating = false) {
  const user = await identity();
  if (!user) throw new HttpError(401, "Sign in with Discord to continue");
  const guilds = await manageableGuilds(user, mutating);
  const guild = guilds.find((g) => g.id === guildId);
  if (!guild)
    throw new HttpError(
      403,
      "You need Manage Server permission to access this community"
    );
  return { user, guild, guilds };
}
export async function createSession(rawToken: unknown, rawUser: unknown) {
  const token = tokenSchema.parse(rawToken);
  const user = profileSchema.parse(rawUser);
  const sessionToken = randomBytes(32).toString("base64url");
  await database()
    .db.insert(schema.sessions)
    .values({
      id: hash(sessionToken),
      userId: user.id,
      ...profileDetails(user),
      accessToken: encrypt(token.access_token, required("APP_SECRET")),
      refreshToken: encrypt(token.refresh_token, required("APP_SECRET")),
      tokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
      expiresAt: new Date(Date.now() + 7 * 86400000),
    });
  return sessionToken;
}

/** Refresh only the signed-in global profile; no guild-member scope or passive polling. */
export async function refreshProfile(user: Identity): Promise<Identity> {
  if (isDemo()) return user;
  if (!user.sessionId || !user.accessToken)
    throw new HttpError(401, "Sign in with Discord to continue");
  const profile = await fetchDiscordProfile(user.accessToken);
  if (profile.id !== user.id)
    throw new HttpError(
      401,
      "Discord returned a different account. Sign in again."
    );
  const details = profileDetails(profile);
  const [saved] = await database()
    .db.update(schema.sessions)
    .set(details)
    .where(
      and(
        eq(schema.sessions.id, user.sessionId),
        eq(schema.sessions.userId, user.id),
        gt(schema.sessions.expiresAt, new Date())
      )
    )
    .returning({ id: schema.sessions.id });
  if (!saved) throw new HttpError(401, "Your session expired. Sign in again.");
  return { ...user, ...details };
}
