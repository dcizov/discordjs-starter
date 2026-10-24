import type { DashboardData } from "@orbit/core";
import { defaultConfig, isDemo } from "@orbit/core";
import { emptyMusic, getDashboardData, getAccount } from "@orbit/db";
import "server-only";
import { authorize } from "./auth";
export async function loadDashboard(guildId: string): Promise<DashboardData> {
  const { user, guild, guilds } = await authorize(guildId);
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
    wallet: guild.installed ? await getAccount(guildId, user.id) : null,
    integrations: {
      itad: !!process.env.ITAD_API_KEY,
      lavalink: !!process.env.LAVALINK_URL && !!process.env.LAVALINK_PASSWORD,
    },
    user: { id: user.id, name: user.name, avatar: user.avatar },
    guilds,
  };
}
