import type { CommunityKind } from "@orbit/core/community";
import { listCommunityPosts, getOwnEconomyHistory } from "@orbit/db";
import type { DashboardData } from "@orbit/core";
import { activitySnapshot } from "@orbit/core/activity";
import { activityCounts } from "@orbit/db";
import { defaultConfig } from "@orbit/core";
import { isDemo } from "@orbit/core/environment";
import { emptyMusic, getDashboardData, getAccount } from "@orbit/db";
import "server-only";
import { authorize, HttpError } from "./auth";
import { guildIconUrl, publicUser, userAvatarUrl } from "./discord-images";
export async function loadDashboard(
  guildId: string,
  authorized?: Awaited<ReturnType<typeof authorize>>,
  scope: { communityKind?: CommunityKind; ownLedger?: boolean } = {}
): Promise<DashboardData> {
  const { communityKind, ownLedger } = scope;
  const referenceAt = new Date().toISOString();
  const { user, guild, guilds } = authorized ?? (await authorize(guildId));
  if (guild.id !== guildId)
    throw new HttpError(
      403,
      "Server authorization does not match this workspace"
    );
  const data = guild.installed
    ? await getDashboardData(guildId)
    : {
        guild: {
          ...guild,
          memberCount: 0,
          config: defaultConfig,
          roles: [],
          channels: [],
          botRolePosition: 0,
          updatedAt: new Date().toISOString(),
        },
        resources: [],
        audit: [],
        ledger: [],
        accounts: [],
        deliveries: [],
        music: emptyMusic(),
        health: [],
        demo: isDemo(),
      };
  return {
    ...data,
    guild: {
      ...data.guild,
      name: guild.name,
      icon: guild.icon,
      iconUrl: guildIconUrl(guild.id, guild.icon),
    },
    ...(communityKind && guild.installed
      ? {
          community: await listCommunityPosts(guildId, { kind: communityKind }),
        }
      : {}),
    presentation: {
      referenceAt,
      activity: activitySnapshot(
        referenceAt,
        data.guild.config.timezone,
        guild.installed && !data.demo
          ? await activityCounts(
              guildId,
              data.guild.config.timezone,
              referenceAt
            )
          : [],
        data.demo
      ),
    },
    wallet: guild.installed ? await getAccount(guildId, user.id) : null,
    ...(ownLedger && guild.installed
      ? { walletHistory: await getOwnEconomyHistory(guildId, user.id) }
      : {}),
    integrations: {
      itad: !!process.env.ITAD_API_KEY,
      lavalink: !!process.env.LAVALINK_URL && !!process.env.LAVALINK_PASSWORD,
    },
    // Audit avatars are the hashes recorded with each action. They are resolved
    // from the row itself (no per-row Discord request) and may be stale: the
    // audit log shows the actor's recorded identity, not their current avatar.
    audit: data.audit.map((entry) => ({
      ...entry,
      actorAvatarUrl: userAvatarUrl(entry.actorId, entry.actorAvatar ?? null),
    })),
    user: publicUser(user),
    guilds: guilds.map((g) => ({ ...g, iconUrl: guildIconUrl(g.id, g.icon) })),
  };
}
