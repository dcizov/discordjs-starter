import type { CommandContext } from "./context";
import {
  getOwnEconomyHistory,
  database,
  economyTransaction,
  getDashboardData,
  getAccount,
  listResources,
  schema,
} from "@orbit/db";
import { safeText } from "@orbit/core";
import { communityDate } from "@orbit/core/community";
import { and, eq } from "drizzle-orm";
import {
  balanceCard,
  dailyCard,
  leaderboardCard,
} from "../interactions/replies";
import { claimShopRole } from "../features/roles/shop";
export async function economyCommand(context: CommandContext) {
  const { i, guild, member, config, reply } = context;
  const key = `interaction-${i.id}`;
  if (i.commandName !== "transactions" && !config.modules.economy)
    throw new Error("The community economy is paused.");

  switch (i.commandName) {
    case "transactions": {
      const result = await getOwnEconomyHistory(guild.id, member.id, {
        page: i.options.getInteger("page") ?? 1,
        pageSize: 10,
      });
      await reply({
        title: "Your transaction history",
        description: result.rows.length
          ? result.rows
              .map(
                (r) =>
                  `${r.amount > 0 ? "+" : ""}${r.amount} ${config.economy.currency} · ${r.type} · ${communityDate(r.createdAt, config.timezone)}\n${safeText(r.note, 100)}`
              )
              .join("\n\n")
          : "No transactions on this page. No reward, transfer or purchase was created by reading this history.",
        footer: `Only your ledger in this server · page ${result.page}/${Math.max(1, Math.ceil(result.total / result.pageSize))} · /transactions page:<number>`,
      });
      break;
    }
    case "balance": {
      const id = i.options.getUser("member")?.id ?? member.id;
      const account = await getAccount(guild.id, id);
      await reply(
        balanceCard(
          account?.name ?? (id === member.id ? member.displayName : id),
          account?.balance ?? 0,
          config.economy
        )
      );
      break;
    }
    case "daily": {
      const r = await economyTransaction({
        guildId: guild.id,
        userId: member.id,
        userName: member.displayName,
        userAvatar: member.user.avatar,
        type: "daily",
        key,
      });
      await reply(dailyCard(r, config.economy));
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
        userAvatar: member.user.avatar,
        type: "transfer",
        key,
        toUserId: recipient.id,
        toUserName: recipient.displayName,
        toUserAvatar: recipient.user.avatar,
        amount: i.options.getInteger("amount", true),
        note: `A thank-you from ${member.displayName}`,
      });
      await reply(
        `Sent ${Math.abs(r.amount)} ${config.economy.currency} to ${recipient.displayName}. A little appreciation goes a long way.`
      );
      break;
    }
    case "leaderboard": {
      const d = await getDashboardData(guild.id);
      await reply(leaderboardCard(d.accounts, config.economy));
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
                    `${item.data.emoji} ${item.name} · ${item.data.price} ${config.economy.currency}\n${safeText(item.data.description, 100)}\nID: ${item.id}${item.data.stock === 0 ? " · Sold out" : ""}`
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
        userAvatar: member.user.avatar,
        type: "purchase",
        key,
        itemId,
      });
      if (r.roleId) {
        try {
          await claimShopRole(member, itemId);
        } catch (e) {
          await reply(
            `Purchase recorded: ${r.itemName}. Role delivery needs attention: ${e instanceof Error ? e.message : "Role delivery failed"} Use /shop claim after permissions are fixed; you won’t pay again.`
          );
          break;
        }
      }
      await reply(
        `A little treat: ${r.itemName}. Balance: ${r.balance} ${config.economy.currency}. Your entitlement is saved in /inventory.`
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
  }
}
