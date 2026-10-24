import type { GuildRole } from "@orbit/core";
import {
  assertAssignableRole,
  fingerprint,
  planRoleAssignment,
  safeText,
} from "@orbit/core";
import { redisConnection } from "@orbit/core/queue";
import { getGuild, getResource, listResources, saveResource } from "@orbit/db";
import type {
  ButtonInteraction,
  Client,
  Guild,
  GuildMember,
  MessageReaction,
  PartialMessageReaction,
  PartialUser,
  StringSelectMenuInteraction,
  User,
} from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
} from "discord.js";
export const roleView = (g: Guild): GuildRole[] =>
  g.roles.cache.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.hexColor,
    position: r.position,
    permissions: r.permissions.bitfield.toString(),
    managed: r.managed,
  }));
export async function memberLock<T>(
  guildId: string,
  memberId: string,
  fn: () => Promise<T>
) {
  const redis = redisConnection(),
    key = `role-lock:${guildId}:${memberId}`,
    token = crypto.randomUUID();
  const acquired = await redis.set(key, token, "PX", 60000, "NX");
  if (!acquired)
    throw new Error(
      "Another role change is in progress. Please try again in a moment."
    );
  try {
    return await fn();
  } finally {
    await redis.eval(
      "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",
      1,
      key,
      token
    );
  }
}
export async function publishPanel(
  client: Client,
  guildId: string,
  panelId: string,
  actorId: string
) {
  const guild = await client.guilds.fetch(guildId),
    actor = await guild.members.fetch(actorId),
    me = await guild.members.fetchMe();
  if (
    !actor.permissions.has(PermissionFlagsBits.ManageRoles) &&
    !actor.permissions.has(PermissionFlagsBits.ManageGuild)
  )
    throw new Error("Manage Roles or Manage Server is required");
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles))
    throw new Error("Orbit needs Manage Roles permission");
  const config = await getGuild(guildId),
    panel = await getResource(guildId, panelId);
  if (
    !config?.config.modules.roles ||
    !panel ||
    panel.kind !== "panel" ||
    !panel.enabled
  )
    throw new Error("The role panel is unavailable or paused");
  await guild.roles.fetch();
  for (const id of panel.data.roleIds)
    assertAssignableRole(
      roleView(guild).find((r) => r.id === id),
      me.roles.highest.position,
      guild.id
    );
  const channel = await guild.channels.fetch(panel.data.channelId);
  if (
    !channel?.isTextBased() ||
    !("send" in channel) ||
    !channel
      .permissionsFor(me)
      ?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
      ])
  )
    throw new Error(
      "The destination is unavailable or Orbit lacks View Channel, Send Messages, or Embed Links"
    );
  const embed = new EmbedBuilder()
    .setTitle(safeText(panel.name, 80))
    .setDescription(safeText(panel.data.description, 1000))
    .setColor(0x9b7ada)
    .setFooter({
      text:
        panel.data.selection === "single"
          ? "Choose one role. Change your mind anytime."
          : `Choose up to ${panel.data.maxRoles} roles.`,
    });
  const components: ActionRowBuilder<any>[] = [];
  if (panel.data.mode === "select") {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`role:${panel.id}:select`)
      .setPlaceholder("A little more you. Choose your roles…")
      .setMinValues(0)
      .setMaxValues(
        panel.data.selection === "single"
          ? 1
          : Math.min(panel.data.maxRoles, panel.data.roleIds.length)
      )
      .addOptions(
        panel.data.roleIds.map((id: string, i: number) => ({
          label: guild.roles.cache.get(id)?.name.slice(0, 100) ?? "Role",
          value: id,
          ...(panel.data.emojis?.[i] ? { emoji: panel.data.emojis[i] } : {}),
        }))
      );
    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)
    );
  } else if (panel.data.mode === "buttons") {
    for (let i = 0; i < panel.data.roleIds.length; i += 5)
      components.push(
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          panel.data.roleIds.slice(i, i + 5).map((id: string, j: number) => {
            const button = new ButtonBuilder()
              .setCustomId(`role:${panel.id}:${id}`)
              .setLabel(guild.roles.cache.get(id)?.name.slice(0, 80) ?? "Role")
              .setStyle(ButtonStyle.Secondary);
            if (panel.data.emojis?.[i + j])
              button.setEmoji(panel.data.emojis[i + j]);
            return button;
          })
        )
      );
  }
  let message = panel.data.messageId
    ? await channel.messages.fetch(panel.data.messageId).catch(() => null)
    : null;
  if (message?.author.id !== client.user!.id) message = null;
  if (message)
    await message.edit({
      embeds: [embed],
      components,
      allowedMentions: { parse: [] },
    });
  else
    message = await channel.send({
      embeds: [embed],
      components,
      allowedMentions: { parse: [] },
      nonce: fingerprint(guildId, panelId, panel.updatedAt).slice(0, 24),
      enforceNonce: true,
    });
  if (panel.data.mode === "reaction")
    for (const emoji of panel.data.emojis) await message.react(emoji);
  await saveResource(
    guildId,
    "panel",
    {
      name: panel.name,
      enabled: panel.enabled,
      data: { ...panel.data, messageId: message.id },
    },
    { id: actor.id, name: actor.displayName },
    panel.id
  );
  return { messageId: message.id, channelId: channel.id };
}
async function assign(
  member: GuildMember,
  panelId: string,
  choose: (current: string[], panel: any) => string[]
) {
  return memberLock(member.guild.id, member.id, async () => {
    const guild = member.guild;
    const config = await getGuild(guild.id);
    const panel = await getResource(guild.id, panelId);
    if (
      !config?.config.modules.roles ||
      !panel ||
      panel.kind !== "panel" ||
      !panel.enabled
    )
      throw new Error("This role panel is no longer active.");
    await guild.roles.fetch();
    const me = await guild.members.fetchMe();
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles))
      throw new Error("Orbit needs Manage Roles permission.");
    member = await guild.members.fetch({ user: member.id, force: true });
    const current = member.roles.cache.map((r) => r.id);
    const requested = choose(current, panel);
    const plan = planRoleAssignment({
      roles: roleView(guild),
      botPosition: me.roles.highest.position,
      guildId: guild.id,
      currentIds: current,
      requestedIds: requested,
      allowedIds: panel.data.roleIds,
      prerequisiteIds: panel.data.prerequisiteIds,
      exclusiveIds: panel.data.exclusiveRoleIds,
      maxRoles: panel.data.maxRoles,
      single: panel.data.selection === "single",
    });
    if (plan.remove.length)
      await member.roles.remove(
        plan.remove,
        `Self-role panel: ${safeText(panel.name, 80)}`
      );
    if (plan.add.length)
      await member.roles.add(
        plan.add,
        `Self-role panel: ${safeText(panel.name, 80)}`
      );
    return requested.length
      ? "Your roles are right where they belong. ✦"
      : "Your panel roles have been cleared.";
  });
}
export async function handleRoleInteraction(
  i: ButtonInteraction | StringSelectMenuInteraction
) {
  if (!i.guild || !i.customId.startsWith("role:")) return;
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const [, panelId, id] = i.customId.split(":");
  const member = await i.guild.members.fetch(i.user.id);
  const text = await assign(member, panelId, (current, panel) => {
    if (i.isStringSelectMenu()) return i.values;
    const selected = current.filter((r) => panel.data.roleIds.includes(r));
    return selected.includes(id)
      ? selected.filter((r) => r !== id)
      : panel.data.selection === "single"
        ? [id]
        : [...selected, id];
  });
  await i.editReply({ content: text, allowedMentions: { parse: [] } });
}
export async function handleReaction(
  reaction: MessageReaction | PartialMessageReaction,
  user: User | PartialUser,
  added: boolean
) {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch();
  if (!reaction.message.guild) return;
  const guild = reaction.message.guild;
  const panels = await listResources(guild.id, "panel");
  const panel = panels.find(
    (p) =>
      p.enabled &&
      p.data.mode === "reaction" &&
      p.data.messageId === reaction.message.id
  );
  if (!panel) return;
  const emoji = reaction.emoji.id
    ? `<${reaction.emoji.animated ? "a" : ""}:${reaction.emoji.name}:${reaction.emoji.id}>`
    : reaction.emoji.name;
  const index = panel.data.emojis.findIndex(
    (e: string) => e === emoji || e === reaction.emoji.id
  );
  if (index < 0) return;
  const member = await guild.members.fetch(user.id);
  const id = panel.data.roleIds[index];
  try {
    await assign(member, panel.id, (current, p) => {
      const selected = current.filter((r) => p.data.roleIds.includes(r));
      return added
        ? p.data.selection === "single"
          ? [id]
          : [...new Set([...selected, id])]
        : selected.filter((r) => r !== id);
    });
  } catch (e: any) {
    if (added) await reaction.users.remove(user.id).catch(() => {});
    await member
      .send({
        content: safeText(`I couldn’t update your role: ${e.message}`),
        allowedMentions: { parse: [] },
      })
      .catch(() => {});
  }
}
