import { safeText } from "@orbit/core";
import { errorDiagnostic } from "@orbit/core/diagnostics";
import { pollSource } from "@orbit/core/feeds";
import { logger } from "@orbit/core/logger";
import {
  audit,
  database,
  economyTransaction,
  getDashboardData,
  getGuild,
  getAccount,
  listResources,
  recordCase,
  schema,
} from "@orbit/db";
import {
  MessageFlags,
  PermissionFlagsBits,
  type Client,
  type Interaction,
} from "discord.js";
import { and, eq } from "drizzle-orm";
import { logCase, moderate } from "./moderation";
import type { MusicService } from "./music";
import { handleRoleInteraction, publishPanel } from "./roles";
import { claimShopRole } from "./shop";
import { handleDeals } from "./deals";
import { dealGameSelection } from "./deal-game-selection";
import {
  balanceCard,
  commandErrorReply,
  commandReply,
  dailyCard,
  leaderboardCard,
  musicActionCard,
  queueCard,
  type ReplyCard,
} from "./replies";
export async function onInteraction(
  client: Client,
  music: MusicService,
  i: Interaction
) {
  if (!i.guild) return;
  try {
    if (i.isButton() || i.isStringSelectMenu()) {
      if (i.customId.startsWith("role:")) await handleRoleInteraction(i);
      return;
    }
    if (i.isAutocomplete()) {
      if (i.commandName === "deals") {
        const focused = i.options.getFocused(true);
        const sub = i.options.getSubcommand(false);
        if (focused.name !== "game" || !["info", "watch"].includes(sub ?? "")) {
          await i.respond([]);
          return;
        }
        const stored = await getGuild(i.guild.id);
        const allowed =
          stored?.config.modules.deals &&
          (sub !== "watch" ||
            i.memberPermissions?.has(PermissionFlagsBits.ManageGuild));
        await i.respond(
          allowed
            ? dealGameSelection.choices(
                i.guild.id,
                i.user.id,
                String(focused.value)
              )
            : []
        );
        return;
      }
      const kind =
        i.commandName === "shop"
          ? "shop"
          : i.commandName === "news"
            ? "source"
            : "panel";
      const q = i.options.getFocused().toLowerCase();
      const resources = (await listResources(i.guild.id, kind))
        .filter((r) => r.enabled && r.name.toLowerCase().includes(q))
        .slice(0, 25);
      await i.respond(
        resources.map((r) => ({ name: r.name.slice(0, 100), value: r.id }))
      );
      return;
    }
    if (!i.isChatInputCommand()) return;
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const guild = i.guild,
      member = await guild.members.fetch({ user: i.user.id, force: true }),
      actor = { id: member.id, name: member.displayName };
    const stored = await getGuild(guild.id);
    if (!stored)
      throw new Error(
        "Orbit is still syncing this community. Please try again in a moment."
      );
    const reply = (content: string | ReplyCard) =>
      i.editReply(commandReply(i.commandName, content));
    const key = `interaction-${i.id}`;
    if (["warn", "timeout", "kick", "ban"].includes(i.commandName)) {
      const user = i.options.getUser("member", true);
      const target = await guild.members
        .fetch({ user: user.id, force: true })
        .catch(() => null);
      if (!target)
        throw new Error("That user is not currently a member of this server.");
      const record = await moderate({
        guild,
        actor: member,
        target,
        type: i.commandName as "warn" | "timeout" | "kick" | "ban",
        reason: i.options.getString("reason", true),
        minutes: i.options.getInteger("minutes") ?? undefined,
      });
      await reply(
        `${i.commandName} recorded for ${target.displayName}. Case ${record.id}.`
      );
      return;
    }
    if (
      [
        "balance",
        "daily",
        "transfer",
        "leaderboard",
        "shop",
        "inventory",
      ].includes(i.commandName) &&
      !stored.config.modules.economy
    )
      throw new Error("The community economy is paused.");
    switch (i.commandName) {
      case "ping":
        await reply(
          `Orbit is here. Gateway: ${client.ws.ping}ms. Configuration is live.`
        );
        break;
      case "roles": {
        if (!stored.config.modules.roles)
          throw new Error("Self roles are paused.");
        const panels = (await listResources(guild.id, "panel")).filter(
          (r) => r.enabled
        );
        await reply(
          panels.length
            ? panels
                .map(
                  (p) =>
                    `${p.name} — ${p.data.messageId ? `https://discord.com/channels/${guild.id}/${p.data.channelId}/${p.data.messageId}` : "Not published yet"}`
                )
                .join("\n")
            : "No role panels are published yet. Ask an administrator to create one in the dashboard."
        );
        break;
      }
      case "role-panel": {
        const result = await publishPanel(
          client,
          guild.id,
          i.options.getString("panel", true),
          member.id
        );
        await reply(
          `Your role panel is ready: https://discord.com/channels/${guild.id}/${result.channelId}/${result.messageId}`
        );
        break;
      }
      case "purge": {
        if (!stored.config.modules.moderation)
          throw new Error("Moderation is paused.");
        const me = await guild.members.fetchMe();
        if (
          !i.channel ||
          !("bulkDelete" in i.channel) ||
          !member
            .permissionsIn(i.channel)
            .has(PermissionFlagsBits.ManageMessages) ||
          !me.permissionsIn(i.channel).has(PermissionFlagsBits.ManageMessages)
        )
          throw new Error(
            "Both you and Orbit need Manage Messages in a server text channel."
          );
        const count = i.options.getInteger("amount", true);
        const deleted = await i.channel.bulkDelete(count, true);
        if (!deleted.size) {
          await reply(
            "No eligible recent messages were found. Messages older than 14 days are skipped."
          );
          break;
        }
        const record = await recordCase(
          guild.id,
          {
            name: `Purge · ${deleted.size} messages`,
            enabled: true,
            data: {
              targetId: member.id,
              type: "purge",
              reason: `Purged ${deleted.size} recent messages from #${"name" in i.channel ? i.channel.name : "channel"}`,
              moderatorId: member.id,
              messageCount: deleted.size,
            },
          },
          actor
        );
        await logCase(guild, {
          id: record.id,
          type: "purge",
          targetId: member.id,
          moderator: member.displayName,
          reason: `Removed ${deleted.size} messages`,
        });
        await reply(
          `Removed ${deleted.size} recent messages. Messages older than 14 days are skipped.`
        );
        break;
      }
      case "cases": {
        if (!member.permissions.has(PermissionFlagsBits.ModerateMembers))
          throw new Error("Moderate Members is required.");
        const target = i.options.getUser("member");
        const cases = (await listResources(guild.id, "case"))
          .filter((r) => !target || r.data.targetId === target.id)
          .slice(0, 10);
        await reply(
          cases.length
            ? cases
                .map(
                  (c) =>
                    `${c.name} · ${c.data.type} · ${c.data.targetId}\n${safeText(c.data.reason, 100)} · ${new Date(c.createdAt).toLocaleDateString()}\nID: ${c.id}`
                )
                .join("\n\n")
            : "No matching moderation cases. A quiet, happy corner."
        );
        break;
      }
      case "balance": {
        const id = i.options.getUser("member")?.id ?? member.id;
        const account = await getAccount(guild.id, id);
        await reply(
          balanceCard(
            account?.name ?? (id === member.id ? member.displayName : id),
            account?.balance ?? 0,
            stored.config.economy
          )
        );
        break;
      }
      case "daily": {
        const r = await economyTransaction({
          guildId: guild.id,
          userId: member.id,
          userName: member.displayName,
          type: "daily",
          key,
        });
        await reply(dailyCard(r, stored.config.economy));
        break;
      }
      case "transfer": {
        const recipient = await guild.members
          .fetch(i.options.getUser("member", true).id)
          .catch(() => null);
        if (!recipient || recipient.user.bot)
          throw new Error("Choose a community member, not a bot.");
        const r = await economyTransaction({
          guildId: guild.id,
          userId: member.id,
          userName: member.displayName,
          type: "transfer",
          key,
          toUserId: recipient.id,
          amount: i.options.getInteger("amount", true),
          note: `A thank-you from ${member.displayName}`,
        });
        await reply(
          `Sent ${Math.abs(r.amount)} ${stored.config.economy.currency} to ${recipient.displayName}. A little appreciation goes a long way.`
        );
        break;
      }
      case "leaderboard": {
        const d = await getDashboardData(guild.id);
        await reply(leaderboardCard(d.accounts, stored.config.economy));
        break;
      }
      case "shop": {
        const sub = i.options.getSubcommand();
        if (sub === "list") {
          const items = (await listResources(guild.id, "shop")).filter(
            (r) => r.enabled
          );
          await reply(
            items.length
              ? items
                  .map(
                    (item) =>
                      `${item.data.emoji} ${item.name} · ${item.data.price} ${stored.config.economy.currency}\n${safeText(item.data.description, 100)}\nID: ${item.id}${item.data.stock === 0 ? " · Sold out" : ""}`
                  )
                  .join("\n\n")
              : "The community shop is getting ready. Check back soon."
          );
          break;
        }
        const itemId = i.options.getString("item", true);
        if (sub === "claim") {
          const name = await claimShopRole(member, itemId);
          await reply(`Your ${name} role has been restored. No extra charge.`);
          break;
        }
        const r = await economyTransaction({
          guildId: guild.id,
          userId: member.id,
          userName: member.displayName,
          type: "purchase",
          key,
          itemId,
        });
        if (r.roleId) {
          try {
            await claimShopRole(member, itemId);
          } catch (e: any) {
            await reply(
              `Purchase recorded: ${r.itemName}. Role delivery needs attention: ${e.message} Use /shop claim after permissions are fixed; you won’t pay again.`
            );
            break;
          }
        }
        await reply(
          `A little treat: ${r.itemName}. Balance: ${r.balance} ${stored.config.economy.currency}. Your entitlement is saved in /inventory.`
        );
        break;
      }
      case "inventory": {
        const owned = await database()
          .db.select()
          .from(schema.inventory)
          .where(
            and(
              eq(schema.inventory.guildId, guild.id),
              eq(schema.inventory.userId, member.id)
            )
          );
        const items = await listResources(guild.id, "shop");
        await reply(
          owned.length
            ? owned
                .slice(0, 20)
                .map(
                  (o) =>
                    `${items.find((item) => item.id === o.resourceId)?.name ?? "Archived item"} × ${o.quantity}`
                )
                .join("\n")
            : "Your inventory is a little quiet. Browse /shop list to find something you love."
        );
        break;
      }
      case "queue": {
        const state = music.state(guild.id);
        await reply(queueCard(state));
        break;
      }
      case "play":
      case "pause":
      case "resume":
      case "skip":
      case "stop":
      case "volume":
      case "shuffle":
      case "repeat": {
        await music.action(member, {
          action: i.commandName,
          query: i.options.getString("query") ?? undefined,
          volume: i.options.getInteger("level") ?? undefined,
          repeat: (i.options.getString("mode") ?? undefined) as
            "off" | "track" | "queue" | undefined,
        });
        await reply(musicActionCard(i.commandName, music.state(guild.id)));
        break;
      }
      case "deals": {
        await handleDeals(i, member);
        break;
      }
      case "news": {
        if (!stored.config.modules.news)
          throw new Error("News aggregation is paused.");
        const sources = await listResources(guild.id, "source");
        if (i.options.getSubcommand() === "list") {
          await reply(
            sources.length
              ? sources
                  .map(
                    (s) =>
                      `${s.name} · ${s.enabled ? s.data.health : "paused"} · ${s.id}`
                  )
                  .join("\n")
              : "No news sources connected yet. Add one in the dashboard."
          );
        } else {
          if (!member.permissions.has(PermissionFlagsBits.ManageGuild))
            throw new Error("Manage Server is required to test a source.");
          const source = sources.find(
            (s) => s.id === i.options.getString("source", true)
          );
          if (!source) throw new Error("Source not found in this server.");
          const items = await pollSource(source);
          await reply(
            `Source reached. ${items.length} recent items. Nothing was delivered.\n${items
              .slice(0, 3)
              .map((item) => `• ${item.title}`)
              .join("\n")}`
          );
        }
        break;
      }
      default:
        await reply(
          "That command is not available. Try /roles, /daily, /shop, or /play."
        );
    }
  } catch (e: unknown) {
    const detail = errorDiagnostic(e);
    if (
      i.isChatInputCommand() &&
      [
        "play",
        "pause",
        "resume",
        "skip",
        "stop",
        "volume",
        "shuffle",
        "repeat",
      ].includes(i.commandName)
    )
      await audit(
        i.guild.id,
        { id: i.user.id, name: i.user.displayName },
        "failed",
        `music /${i.commandName}`,
        detail
      ).catch((error) =>
        logger.warn(
          { error: errorDiagnostic(error) },
          "Could not save music command failure"
        )
      );
    logger.warn(
      { guildId: i.guildId, interactionType: i.type, error: detail },
      "Interaction could not be completed"
    );
    if (i.isAutocomplete()) {
      if (!i.responded) await i.respond([]).catch(() => {});
      return;
    }
    if (i.isRepliable()) {
      const text = commandErrorReply(
        i.isChatInputCommand() ? i.commandName : "roles",
        detail
      );
      if (i.deferred || i.replied) await i.editReply(text).catch(() => {});
      else
        await i
          .reply({ ...text, flags: MessageFlags.Ephemeral })
          .catch(() => {});
    }
  }
}
