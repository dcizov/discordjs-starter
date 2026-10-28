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
import {
  guildIconUrl,
  personAvatarUrl,
  publicUser,
  userAvatarUrl,
} from "./discord-images";
import { getMemberIdentities, type MemberIdentity } from "@orbit/db";
import { displayName, secondaryName } from "@orbit/core/identity";
type AccountRecord = NonNullable<Awaited<ReturnType<typeof getAccount>>>;
/**
 * Attach the current guild identity once, on the server, for either a list or a
 * wallet.
 *
 * The hash captured on someone's last economy interaction is only a fallback:
 * when the roster knows this member, the name and picture this server actually
 * shows (nickname, guild avatar) win, and they are read from rows the bot already
 * holds. No Discord request, and no waiting for the member to interact again.
 */
function withAccountAvatar<T extends AccountRecord>(
  account: T,
  member?: MemberIdentity
): T & { username: string | null; globalName: string | null } {
  const names = {
    username: member?.username ?? account.username ?? null,
    globalName: member?.globalName ?? account.globalName ?? null,
    nickname: member?.nickname ?? null,
  };
  return {
    ...account,
    ...names,
    avatarUrl: personAvatarUrl({
      guildId: account.guildId,
      userId: account.userId,
      guildAvatar: member?.guildAvatar ?? account.guildAvatar ?? null,
      avatar: member?.avatar ?? account.avatar ?? null,
    }),
  };
}
/**
 * An XP leaderboard row joined to the roster.
 *
 * Unlike the economy's accounts, an XP row records no name of its own, so its
 * whole identity comes from the synchronized roster. A member with no roster
 * row is left with a bare id: the board must not invent a name to fill a gap.
 */
function withXpIdentity<
  T extends { guildId: string; userId: string; total: number },
>(row: T, member?: MemberIdentity) {
  return {
    ...row,
    username: member?.username ?? null,
    globalName: member?.globalName ?? null,
    nickname: member?.nickname ?? null,
    avatarUrl: personAvatarUrl({
      guildId: row.guildId,
      userId: row.userId,
      guildAvatar: member?.guildAvatar ?? null,
      avatar: member?.avatar ?? null,
    }),
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
/**
 * The roster row's picture, resolved once on the server: guild avatar first, then
 * the account's global avatar. `null` means Discord has neither, and the cell
 * says so with initials instead of a broken image.
 */
/**
 * Attach the derived avatar URL to one roster member.
 *
 * Delegates to `toMemberWire`, which is the only place the URL is derived, so
 * the dashboard projection and the member directory cannot drift apart. They
 * did: this one derived it, the members route did not, and the directory
 * showed initials for everyone while the leaderboard beside it showed faces.
 */
export function withMemberAvatarUrl<
  T extends {
    userId: string;
    guildAvatar?: string | null;
    avatar?: string | null;
  },
>(member: T, guildId: string): T & { avatarUrl: string | null } {
  return {
    ...member,
    avatarUrl: personAvatarUrl({
      guildId,
      userId: member.userId,
      guildAvatar: member.guildAvatar ?? null,
      avatar: member.avatar ?? null,
    }),
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
  // One batched read: the roster's current names and pictures for everyone this
  // response mentions. Current surfaces use it instead of their own captures.
  const identities = guild.installed
    ? new Map(
        (
          await getMemberIdentities(guildId, [
            ...data.accounts.map((account) => account.userId),
            // The XP board earns its names from this same roster read. XP rows
            // hold a bare id, so joining here is what lets the board show who
            // someone actually is without a request per row.
            ...(data.xpBoard?.rows ?? []).map((row) => row.userId),
            user.id,
          ])
        ).map((identity) => [identity.userId, identity])
      )
    : new Map<string, MemberIdentity>();
  const me = identities.get(user.id);
  const meNames = {
    username: me?.username ?? null,
    globalName: me?.globalName ?? null,
    nickname: me?.nickname ?? null,
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
          account ? withAccountAvatar(account, me) : null
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
    accounts: data.accounts.map((account) =>
      withAccountAvatar(account, identities.get(account.userId))
    ),
    // XP rows carry an id and nothing else. The board is still about *people*,
    // so the roster's current names and pictures are joined here. A member with
    // no roster row - someone who left, or a server that has never synced - is
    // left with a bare id rather than an invented name.
    xpBoard: data.xpBoard
      ? {
          ...data.xpBoard,
          rows: data.xpBoard.rows.map((row) =>
            withXpIdentity(row, identities.get(row.userId))
          ),
        }
      : undefined,
    audit: data.audit.map(withAuditAvatarUrl),
    // The account menu is the signed-in person *in this server*: a nickname is
    // shown with the handle beside it, and the guild avatar wins over the global
    // one exactly as it does in every other list.
    user: {
      ...publicUser(user),
      ...meNames,
      name: displayName({ ...meNames, storedName: user.name }, "guild"),
      secondaryName: secondaryName(
        { ...meNames, storedName: user.name },
        "guild"
      ),
      avatarUrl: personAvatarUrl({
        guildId,
        userId: user.id,
        guildAvatar: me?.guildAvatar ?? null,
        avatar: me?.avatar ?? user.avatar ?? null,
      }),
    },
    guilds: guilds.map((g) => ({ ...g, iconUrl: guildIconUrl(g.id, g.icon) })),
  };
}
