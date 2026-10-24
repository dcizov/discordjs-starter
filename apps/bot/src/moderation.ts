import { assertModeratable, safeText } from "@orbit/core";
import { logger } from "@orbit/core/logger";
import { getGuild, listResources, recordCase } from "@orbit/db";
import type { Guild, GuildMember } from "discord.js";
import { EmbedBuilder, PermissionFlagsBits } from "discord.js";
const permissions = {
  warn: PermissionFlagsBits.ModerateMembers,
  timeout: PermissionFlagsBits.ModerateMembers,
  kick: PermissionFlagsBits.KickMembers,
  ban: PermissionFlagsBits.BanMembers,
};
export async function moderate(input: {
  guild: Guild;
  actor: GuildMember;
  target: GuildMember;
  type: keyof typeof permissions;
  reason: string;
  minutes?: number;
  automod?: boolean;
}) {
  const { guild, actor, target, type } = input;
  const stored = await getGuild(guild.id);
  if (!stored?.config.modules.moderation)
    throw new Error("Moderation is paused in this server.");
  const me = await guild.members.fetchMe(),
    permission = permissions[type];
  if (!actor.permissions.has(permission) || !me.permissions.has(permission))
    throw new Error(
      `Both you and Orbit need ${type === "kick" ? "Kick Members" : type === "ban" ? "Ban Members" : "Moderate Members"} permission.`
    );
  assertModeratable(
    actor.id === guild.ownerId ? Infinity : actor.roles.highest.position,
    me.roles.highest.position,
    target.roles.highest.position,
    target.id === guild.ownerId,
    target.id === actor.id || target.id === me.id
  );
  if (
    type === "timeout" &&
    target.permissions.has(PermissionFlagsBits.Administrator)
  )
    throw new Error("Discord does not allow timing out administrators.");
  const reason = safeText(input.reason, 500);
  if (!reason.trim()) throw new Error("A reason is required.");
  if (type === "timeout") {
    if (
      !Number.isInteger(input.minutes) ||
      input.minutes! < 1 ||
      input.minutes! > 40320
    )
      throw new Error("Timeout duration must be from 1 minute to 28 days.");
    await target.timeout(input.minutes! * 60000, reason);
  }
  if (type === "kick") await target.kick(reason);
  if (type === "ban") await target.ban({ reason, deleteMessageSeconds: 0 });
  const record = await recordCase(
    guild.id,
    {
      name: `${type[0].toUpperCase() + type.slice(1)} · ${target.user.username}`.slice(
        0,
        80
      ),
      enabled: true,
      data: {
        targetId: target.id,
        type,
        reason,
        moderatorId: actor.id,
        ...(input.minutes ? { durationMinutes: input.minutes } : {}),
      },
    },
    { id: actor.id, name: input.automod ? "Orbit automod" : actor.displayName }
  );
  await logCase(guild, {
    id: record.id,
    type,
    targetId: target.id,
    moderator: actor.displayName,
    reason,
  });
  if (type === "warn") {
    await target
      .send({
        content: safeText(
          `A note from ${guild.name}: you received a warning. Reason: ${reason}`,
          1900
        ),
        allowedMentions: { parse: [] },
      })
      .catch(() => {});
    const cases = (await listResources(guild.id, "case")).filter(
      (c) =>
        c.data.type === "warn" &&
        c.data.targetId === target.id &&
        Date.now() - new Date(c.createdAt).getTime() < 86400000
    );
    if (
      cases.length >= stored.config.moderation.escalationThreshold &&
      target.moderatable
    ) {
      await target.timeout(
        stored.config.moderation.escalationMinutes * 60000,
        "Automatic escalation: repeated warnings"
      );
      await recordCase(
        guild.id,
        {
          name: `Escalation · ${target.user.username}`.slice(0, 80),
          enabled: true,
          data: {
            targetId: target.id,
            type: "timeout",
            reason: `Automatic escalation after ${cases.length} warnings in 24 hours`,
            moderatorId: me.id,
            durationMinutes: stored.config.moderation.escalationMinutes,
          },
        },
        { id: me.id, name: "Orbit automod" }
      );
      await logCase(guild, {
        id: "escalation",
        type: "timeout",
        targetId: target.id,
        moderator: "Orbit",
        reason: `Repeated warnings: ${cases.length} in 24 hours`,
      });
    }
  }
  return record;
}
export async function logCase(
  guild: Guild,
  c: {
    id: string;
    type: string;
    targetId: string;
    moderator: string;
    reason: string;
  }
) {
  const config = await getGuild(guild.id);
  if (!config?.config.auditChannelId) return;
  try {
    const channel = await guild.channels.fetch(config.config.auditChannelId);
    if (!channel?.isTextBased() || !("send" in channel))
      throw new Error("Audit channel is not available");
    const me = await guild.members.fetchMe();
    if (
      !channel
        .permissionsFor(me)
        ?.has([
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
        ])
    )
      throw new Error("Missing audit channel permissions");
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(`Moderation · ${safeText(c.type, 20)}`)
          .setColor(0xc9a17a)
          .addFields(
            { name: "Member ID", value: c.targetId },
            { name: "Moderator", value: safeText(c.moderator, 80) },
            { name: "Reason", value: safeText(c.reason, 500) }
          )
          .setFooter({ text: `Case ${c.id}` })
          .setTimestamp(),
      ],
      allowedMentions: { parse: [] },
    });
  } catch (e: any) {
    logger.warn(
      { guildId: guild.id, error: e.message },
      "Moderation audit channel unavailable"
    );
  }
}
