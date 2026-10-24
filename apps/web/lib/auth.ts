import {
  canManageGuild,
  decrypt,
  DEMO_USER_ID,
  encrypt,
  isDemo,
  required,
} from "@orbit/core";
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
export type Identity = {
  id: string;
  name: string;
  avatar: string | null;
  sessionId?: string;
  accessToken?: string;
};
export const hash = (v: string) => createHash("sha256").update(v).digest("hex");
export async function identity(): Promise<Identity | null> {
  if (isDemo()) return { id: DEMO_USER_ID, name: "Jamie Davis", avatar: null };
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
    const res = await fetch("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: required("DISCORD_CLIENT_ID"),
        client_secret: required("DISCORD_CLIENT_SECRET"),
        grant_type: "refresh_token",
        refresh_token: decrypt(s.refreshToken, required("APP_SECRET")),
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const t = await res.json();
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
export async function createSession(token: any, user: any) {
  const sessionToken = randomBytes(32).toString("base64url");
  await database()
    .db.insert(schema.sessions)
    .values({
      id: hash(sessionToken),
      userId: user.id,
      name: user.global_name ?? user.username,
      avatar: user.avatar ?? null,
      accessToken: encrypt(token.access_token, required("APP_SECRET")),
      refreshToken: encrypt(token.refresh_token, required("APP_SECRET")),
      tokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
      expiresAt: new Date(Date.now() + 7 * 86400000),
    });
  return sessionToken;
}
