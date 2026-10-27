import { PermissionFlagsBits } from "discord.js";
import type { CommandContext } from "./context";
import { safeText } from "@orbit/core";
import { reconcileAfterAward } from "../features/leveling/rewards";
import {
  levelProgress,
  totalXpForLevel,
  xpForLevel,
} from "@orbit/core/leveling";
import { audit } from "@orbit/db";
import { awardXp, getXpTotal, listXpLeaderboard } from "@orbit/db";

/**
 * `/rank`, `/top` and `/xp`.
 *
 * `/rank` and `/top` are read-only and answer from the stored totals. `/xp`
 * changes them, so it re-checks the actor's guild permissions here rather than
 * trusting Discord's `defaultMemberPermissions`: that field is a hint to the
 * client, not something the bot is entitled to rely on, and a hand-crafted
 * interaction can carry anything.
 */

/** How many members a leaderboard page shows. */
const BOARD_PAGE = 10;

/** A bar that reads honestly, including at both ends. */
function bar(percent: number, width = 12): string {
  const filled = Math.round(
    (Math.max(0, Math.min(100, percent)) / 100) * width
  );
  return "▓".repeat(filled) + "░".repeat(width - filled);
}

/** The member's display name, falling back to the id rather than "unknown". */
function nameOf(context: CommandContext, userId: string): string {
  const cached = context.guild.members.cache.get(userId);
  return (
    safeText(
      cached?.displayName ??
        cached?.user.username ??
        context.member.displayName,
      40
    ) || userId
  );
}

export async function levelingCommand(context: CommandContext) {
  const { i, guild, member, config, reply } = context;
  if (!config.modules.xp) throw new Error("Leveling is paused in this server.");

  switch (i.commandName) {
    case "rank": {
      const target = i.options.getUser("member") ?? i.user;
      const total = await getXpTotal(guild.id, target.id);
      const progress = levelProgress(total.total);
      const lines = [
        `${bar(progress.percent)}  ${progress.into}/${progress.needed} XP`,
        "",
        `**${progress.level}** · ${progress.total.toLocaleString("en")} XP total`,
        `${progress.remaining.toLocaleString("en")} XP to level ${progress.level + 1}`,
      ];
      if (total.messageXp || total.voiceXp || total.adjustedXp)
        lines.push(
          "",
          `${total.messageXp.toLocaleString("en")} from messages · ${total.voiceXp.toLocaleString("en")} from voice` +
            (total.adjustedXp
              ? ` · ${total.adjustedXp > 0 ? "+" : ""}${total.adjustedXp.toLocaleString("en")} adjusted by a manager`
              : "")
        );
      // Reaching level N in total is a different number from the cost of the
      // next level. Showing both is the cure for the most common confusion
      // about any leveling system.
      lines.push(
        "",
        `_Reaching level ${progress.level} has cost ${totalXpForLevel(progress.level).toLocaleString("en")} XP in total; the next level costs ${xpForLevel(progress.level).toLocaleString("en")}._`
      );
      return reply({
        title: `${nameOf(context, target.id)} · level ${progress.level}`,
        description: lines.join("\n"),
        tone: "info",
      });
    }

    case "levels": {
      const page = i.options.getInteger("page") ?? 1;
      const board = await listXpLeaderboard(guild.id, {
        page,
        pageSize: BOARD_PAGE,
      });
      if (!board.total)
        return reply({
          title: "The XP leaderboard",
          description:
            "Nobody has earned XP here yet. Send a message or join a voice channel to be the first on the board.",
          tone: "info",
        });
      const rows = board.rows.map((row) => {
        const p = levelProgress(row.total);
        return `**${row.rank}.** ${nameOf(context, row.userId)} — level ${p.level} · ${row.total.toLocaleString("en")} XP`;
      });
      const pages = Math.max(1, Math.ceil(board.total / BOARD_PAGE));
      return reply({
        title: `The XP leaderboard · page ${board.page} of ${pages}`,
        description: rows.join("\n"),
        footer: `${board.total.toLocaleString("en")} ${board.total === 1 ? "member has" : "members have"} earned XP`,
        tone: "info",
      });
    }

    case "xp": {
      // Server-side authorization. Discord's defaultMemberPermissions only
      // hides the command; it does not stop a hand-crafted interaction.
      if (!member.permissions.has(PermissionFlagsBits.ManageGuild))
        throw new Error("You need Manage Server to adjust XP.");
      const action = i.options.getSubcommand();
      const target = i.options.getUser("member", true);
      if (target.bot) throw new Error("Bots do not take part in leveling.");

      const current = await getXpTotal(guild.id, target.id);
      let amount: number;
      if (action === "give") amount = i.options.getInteger("amount", true);
      else if (action === "take")
        amount = -i.options.getInteger("amount", true);
      else if (action === "set")
        amount = i.options.getInteger("total", true) - current.total;
      else throw new Error("Unknown XP action");

      if (amount === 0)
        return reply({
          title: "No change",
          description: `${nameOf(context, target.id)} already has that much XP.`,
          tone: "info",
        });

      // Keyed on the interaction, so a retried interaction cannot adjust twice.
      const result = await awardXp(guild.id, target.id, {
        key: `adjust:${i.id}`,
        kind: "adjust",
        amount,
      });

      // An operator's adjustment can drop someone below a reward level, so the
      // same reconciliation runs; it is not only for earned XP.
      await reconcileAfterAward(guild, target.id, result);

      await audit(
        guild.id,
        {
          id: member.id,
          name: member.displayName || member.user.username,
          avatar: member.user.avatar ?? member.avatar ?? null,
        },
        "update",
        "xp-adjust",
        `${action} ${amount > 0 ? "+" : ""}${amount} XP for ${safeText(nameOf(context, target.id), 60)} (${target.id}): now ${result.total} XP, level ${result.level}`
      );

      const progress = levelProgress(result.total);
      return reply({
        title: `XP adjusted · ${nameOf(context, target.id)}`,
        description: [
          `${amount > 0 ? "+" : ""}${amount.toLocaleString("en")} XP`,
          "",
          `Now level ${progress.level} with ${result.total.toLocaleString("en")} XP.`,
          result.leveledUp
            ? `That crossed ${result.levelsGained} ${result.levelsGained === 1 ? "level" : "levels"}.`
            : result.levelsGained < 0
              ? "That moved them down a level."
              : "",
        ]
          .filter(Boolean)
          .join("\n"),
        tone: amount > 0 ? "success" : "error",
      });
    }

    default:
      throw new Error("Unknown leveling command");
  }
}
