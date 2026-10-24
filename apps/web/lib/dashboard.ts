import type { DashboardData } from "@orbit/core";
import { activitySnapshot } from "@orbit/core/activity";
import { activityCounts } from "@orbit/db";
import { defaultConfig, isDemo } from "@orbit/core";
import { emptyMusic, getDashboardData, getAccount } from "@orbit/db";
import "server-only";
import { authorize, HttpError } from "./auth";
export async function loadDashboard(
  guildId: string,
  authorized?: Awaited<ReturnType<typeof authorize>>
): Promise<DashboardData> {
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
    integrations: {
      itad: !!process.env.ITAD_API_KEY,
      lavalink: !!process.env.LAVALINK_URL && !!process.env.LAVALINK_PASSWORD,
    },
    user: { id: user.id, name: user.name, avatar: user.avatar },
    guilds,
  };
}
