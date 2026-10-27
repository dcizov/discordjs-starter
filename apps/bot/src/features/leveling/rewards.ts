import { PermissionFlagsBits, type Guild, type GuildMember } from "discord.js";
import { errorDiagnostic } from "@orbit/core/diagnostics";
import { logger } from "@orbit/core/logger";
import { safeText } from "@orbit/core";
import {
  owedRewards,
  pendingRewards,
  renderAnnouncement,
  rewardRoleIssue,
  rewardsToRevoke,
} from "@orbit/core/leveling-rewards";
import { getGuild } from "@orbit/db";
import { listRewardGrants, recordRewardGrant } from "@orbit/db";

/**
 * Granting level rewards and announcing them.
 *
 * The order here is deliberate and is what satisfies two requirements that
 * pull against each other: a retry must never announce the same level twice,
 * and a failed announcement must never cost anyone their XP.
 *
 * The XP award has already happened by the time this runs — it is committed
 * before reconciliation is even attempted. The grant is then **recorded
 * first** and announced second, inside its own try/catch. So a crash between
 * the two loses an announcement, never a reward; and a retry sees the recorded
 * grant and does nothing.
 */

export type ReconcileResult = {
  granted: string[];
  refused: { roleId: string; reason: string }[];
  missingRole: string[];
  revoked: string[];
  announced: number;
};

const noop: ReconcileResult = {
  granted: [],
  refused: [],
  missingRole: [],
  revoked: [],
  announced: 0,
};

/**
 * Bring a member's reward roles in line with their level.
 *
 * Safe to call repeatedly, and called after every XP change including an
 * operator's adjustment. It handles a member who jumped several levels at
 * once, a reward role deleted since it was configured, and a bot that has
 * lost the permission it needs.
 */
export async function reconcileRewards(
  guild: Guild,
  userId: string
): Promise<ReconcileResult> {
  const stored = await getGuild(guild.id);
  const settings = stored?.config.xp;
  if (!stored || !settings || !stored.config.modules.xp) return noop;
  if (!settings.rewards.length) return noop;

  const total = await getMemberLevel(guild.id, userId);
  const owed = owedRewards(total, settings.rewards, settings.rewardStack);
  const grants = (await listRewardGrants(guild.id, userId)).map((grant) => ({
    level: grant.level,
    roleId: grant.roleId,
    grantedAt: grant.grantedAt,
    error: grant.error,
  }));

  await guild.roles.fetch();
  const roles = guild.roles.cache;
  const me = guild.members.me ?? (await guild.members.fetchMe());
  const botTop = me.roles.highest.position;
  const canManage = me.permissions.has(PermissionFlagsBits.ManageRoles);

  const pending = pendingRewards({
    owed,
    grants,
    availableRoleIds: [...roles.keys()],
  });

  const granted: string[] = [];
  const refused: { roleId: string; reason: string }[] = [];
  let announced = 0;

  for (const reward of [...pending.toGrant, ...pending.retry]) {
    const role = roles.get(reward.roleId);
    const issue = rewardRoleIssue({
      roleExists: !!role,
      managed: role?.managed ?? false,
      isEveryone: role?.id === guild.id,
      hasAdministrator: role ? role.permissions.has("Administrator") : false,
      aboveBotReach: (role?.position ?? Number.MAX_SAFE_INTEGER) >= botTop,
    });
    if (!canManage) {
      const reason = "Orbit needs the Manage Roles permission.";
      refused.push({ roleId: reward.roleId, reason });
      await recordRewardGrant({
        guildId: guild.id,
        userId,
        level: reward.level,
        roleId: reward.roleId,
        grantedAt: null,
        error: reason,
      });
      continue;
    }
    if (issue) {
      refused.push({ roleId: reward.roleId, reason: issue });
      // Recorded even though it was refused, so the dashboard can say why and
      // a later reconcile can retry if the configuration is fixed.
      await recordRewardGrant({
        guildId: guild.id,
        userId,
        level: reward.level,
        roleId: reward.roleId,
        grantedAt: null,
        error: issue,
      });
      continue;
    }

    let member: GuildMember;
    try {
      member = await guild.members.fetch({ user: userId, force: true });
      await member.roles.add(reward.roleId, `Level ${reward.level} reward`);
    } catch (error) {
      const reason = errorDiagnostic(error);
      refused.push({ roleId: reward.roleId, reason });
      await recordRewardGrant({
        guildId: guild.id,
        userId,
        level: reward.level,
        roleId: reward.roleId,
        grantedAt: null,
        error: reason,
      });
      continue;
    }

    // Recorded before the announcement: losing an announcement is a shame,
    // announcing twice is a nuisance to everyone in the channel.
    await recordRewardGrant({
      guildId: guild.id,
      userId,
      level: reward.level,
      roleId: reward.roleId,
      grantedAt: new Date().toISOString(),
      error: null,
    });
    granted.push(reward.roleId);

    if (!settings.announceEnabled || !settings.announceChannelId) continue;
    try {
      const channel = await guild.channels.fetch(settings.announceChannelId);
      if (!channel?.isTextBased() || !("send" in channel)) continue;
      await channel.send({
        content: renderAnnouncement(settings.announceMessage, {
          member: `<@${userId}>`,
          level: reward.level,
          role: role?.name ?? null,
        }),
        allowedMentions: { parse: [] },
      });
      announced += 1;
    } catch (error) {
      // The XP and the role are already recorded. A failed announcement is
      // logged and forgotten; it must never roll anything back.
      logger.warn(
        {
          guildId: guild.id,
          userId,
          level: reward.level,
          error: errorDiagnostic(error),
        },
        "Level reward announcement failed; the reward still stands"
      );
    }
  }

  const revoked: string[] = [];
  if (!settings.rewardStack) {
    const member = await guild.members
      .fetch({ user: userId, force: true })
      .catch(() => null);
    if (member) {
      for (const roleId of rewardsToRevoke({
        owed,
        grants: await listRewardGrants(guild.id, userId).then((rows) =>
          rows.map((grant) => ({
            level: grant.level,
            roleId: grant.roleId,
            grantedAt: grant.grantedAt,
            error: grant.error,
          }))
        ),
        heldRoleIds: [...member.roles.cache.keys()],
        stack: false,
      })) {
        try {
          await member.roles.remove(
            roleId,
            "Higher level reward replaces this"
          );
          revoked.push(roleId);
        } catch (error) {
          logger.warn(
            {
              guildId: guild.id,
              userId,
              roleId,
              error: errorDiagnostic(error),
            },
            "Older level reward could not be removed"
          );
        }
      }
    }
  }

  if (pending.missingRole.length)
    logger.warn(
      {
        guildId: guild.id,
        userId,
        roles: pending.missingRole.map((reward) => reward.roleId),
      },
      "Configured level rewards no longer exist in this server"
    );

  return {
    granted,
    refused,
    missingRole: pending.missingRole.map((reward) => reward.roleId),
    revoked,
    announced,
  };
}

async function getMemberLevel(
  guildId: string,
  userId: string
): Promise<number> {
  const { getXpTotal } = await import("@orbit/db");
  const { levelFromTotalXp } = await import("@orbit/core/leveling");
  const row = await getXpTotal(guildId, userId);
  return levelFromTotalXp(row.total);
}

/** Preview text for the dashboard, so an operator sees what will be posted. */
export function previewAnnouncement(
  template: string,
  memberName: string
): string {
  return safeText(
    renderAnnouncement(template, {
      member: memberName,
      level: 10,
      role: "Regular",
    }),
    500
  );
}

/**
 * Reconcile after an award, never letting a failure undo the award.
 *
 * Wrapping the whole thing is the belt to the try/catch's braces: even an
 * unexpected failure in reimbursement cannot roll back XP that was already
 * committed. Reconciliation is a consequence of earning, not a condition of it.
 */
export async function reconcileAfterAward(
  guild: Guild,
  userId: string,
  result: { applied: boolean }
): Promise<void> {
  if (!result.applied) return;
  try {
    await reconcileRewards(guild, userId);
  } catch (error) {
    logger.warn(
      {
        guildId: guild.id,
        userId,
        error: errorDiagnostic(error),
      },
      "Level reward reconciliation failed; the XP still stands"
    );
  }
}
