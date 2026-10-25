import {
  evaluateRule,
  messageContentHash,
  type RecentMessage,
} from "@orbit/core/automod";
import { logger } from "@orbit/core/logger";
import { economyTransaction, getGuild, listResources } from "@orbit/db";
import type { Message } from "discord.js";
import { PermissionFlagsBits } from "discord.js";
import { logCase, moderate } from "./actions";
const history = new Map<string, RecentMessage[]>();
const lastTriggered = new Map<string, number>();
const locks = new Map<string, Promise<unknown>>();
export async function onMessage(message: Message) {
  const key = `${message.guildId}:${message.author.id}`;
  const prior = locks.get(key) ?? Promise.resolve();
  const next = prior.catch(() => {}).then(() => processMessage(message));
  locks.set(key, next);
  try {
    await next;
  } finally {
    if (locks.get(key) === next) locks.delete(key);
  }
}
async function processMessage(message: Message) {
  if (!message.guild || message.author.bot || message.system || !message.member)
    return;
  const guild = message.guild,
    stored = await getGuild(guild.id);
  if (!stored?.installed) return;
  const member = message.member,
    me = await guild.members.fetchMe();
  const now = Date.now(),
    key = `${guild.id}:${member.id}`;
  const recent = (history.get(key) ?? [])
    .filter((m) => now - m.at <= 300000)
    .slice(-100);
  const roleIds = member.roles.cache.map((r) => r.id);
  const exempt =
    member.id === guild.ownerId ||
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.roles.highest.position >= me.roles.highest.position ||
    stored.config.moderation.exemptRoleIds.some((r) => roleIds.includes(r));
  let hit = false;
  if (stored.config.modules.moderation && !exempt) {
    const rules = await listResources(guild.id, "rule");
    const input = {
      content: message.content,
      mentions:
        message.mentions.users.size +
        message.mentions.roles.size +
        (message.mentions.everyone ? 1 : 0),
      recent,
      now,
      roleIds,
      channelId: message.channelId,
    };
    const priority = { delete: 0, warn: 1, timeout: 2 };
    const triggered = rules
      .filter((r) => evaluateRule(r, input))
      .sort(
        (a, b) =>
          priority[b.data.action as keyof typeof priority] -
          priority[a.data.action as keyof typeof priority]
      )[0];
    if (triggered) {
      hit = true;
      const triggerkey = `${key}:${triggered.id}`;
      if (now - (lastTriggered.get(triggerkey) ?? 0) > 10000) {
        lastTriggered.set(triggerkey, now);
        if (message.deletable) await message.delete().catch(() => {});
        try {
          if (
            triggered.data.action === "warn" ||
            triggered.data.action === "timeout"
          )
            await moderate({
              guild,
              actor: me,
              target: member,
              type: triggered.data.action === "warn" ? "warn" : "timeout",
              reason: `Automod: ${triggered.name}`,
              minutes: triggered.data.durationMinutes,
              automod: true,
            });
          else
            await logCase(guild, {
              id: message.id,
              type: "message deleted",
              targetId: member.id,
              moderator: "Orbit automod",
              reason: `Automod: ${triggered.name}`,
            });
        } catch (e: any) {
          logger.warn(
            { guildId: guild.id, ruleId: triggered.id, error: e.message },
            "Automoderation action unavailable"
          );
        }
      } else if (message.deletable) await message.delete().catch(() => {});
    }
  }
  recent.push({
    at: now,
    contentHash: messageContentHash(message.content),
  });
  history.set(key, recent.slice(-100));
  if (history.size > 10000)
    for (const [k, v] of history)
      if (!v.length || now - v[v.length - 1].at > 300000) history.delete(k);
  while (history.size > 10000) history.delete(history.keys().next().value!);
  if (lastTriggered.size > 10000)
    for (const [k, v] of lastTriggered)
      if (now - v > 300000) lastTriggered.delete(k);
  while (lastTriggered.size > 10000)
    lastTriggered.delete(lastTriggered.keys().next().value!);
  if (
    !hit &&
    stored.config.modules.economy &&
    stored.config.economy.activityAmount > 0 &&
    message.content.trim().length >= 5
  ) {
    try {
      await economyTransaction({
        guildId: guild.id,
        userId: member.id,
        userName: member.displayName,
        type: "activity",
        key: `activity-${message.id}`,
      });
    } catch (e: any) {
      if (!e.message.includes("cooldown"))
        logger.warn(
          { guildId: guild.id, error: e.message },
          "Activity reward unavailable"
        );
    }
  }
}
