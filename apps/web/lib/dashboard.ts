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
type AccountRecord = NonNullable<Awaited<ReturnType<typeof getAccount>>>;
/** Attach the display URL once, on the server, for either a list or a wallet. */
function withAccountAvatar<T extends AccountRecord>(account: T): T {
  return {
    ...account,
    avatarUrl: userAvatarUrl(account.userId, account.avatar ?? null),
  };
}
/**
 * One projection for a historical audit row.
 *
 * The actor's picture is derived from the hash that was stored with the action.
 * It is never looked up again and never replaced by the actor's current profile:
 * an audit row is evidence of what happened then. A row recorded before avatars
 * were captured, or by a system actor, keeps an honest `null` so the component
 * can say so instead of inventing a face. Used by both the dashboard snapshot
 * and the paged `/history` endpoint, because the table is built from the latter.
 */
export function withAuditAvatarUrl<
  T extends { actorId: string; actorAvatar?: string | null },
>(entry: T): T & { actorAvatarUrl: string | null } {
  return {
    ...entry,
    actorAvatarUrl: userAvatarUrl(entry.actorId, entry.actorAvatar ?? null),
  };
}
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
    wallet: guild.installed
      ? await getAccount(guildId, user.id).then((account) =>
          account ? withAccountAvatar(account) : null
        )
      : null,
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
    // Current identity for the people who spend and earn here: the hash the bot
    // captured on their last economy interaction, resolved once per row from
    // data already in this response. No Discord request, and no historical
    // claim — the audit log is the place for "who they were then".
    accounts: data.accounts.map(withAccountAvatar),
    audit: data.audit.map(withAuditAvatarUrl),
    user: publicUser(user),
    guilds: guilds.map((g) => ({ ...g, iconUrl: guildIconUrl(g.id, g.icon) })),
  };
}
