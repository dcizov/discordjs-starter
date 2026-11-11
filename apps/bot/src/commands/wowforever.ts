import { PermissionFlagsBits } from "discord.js";
import {
  foreverCredentials,
  pollForeverRulesets,
} from "@orbit/core/wow-forever-client";
import { summarizeRulesets } from "@orbit/core/wow-forever";
import { saveConfig } from "@orbit/db";
import { logger } from "@orbit/core/logger";
import type { CommandContext } from "./context";

/**
 * `/wowforever`.
 *
 * Reports whether each WoW: Forever ruleset is up, and can announce it in a
 * channel when one changes.
 *
 * **The copy here carries a burden the code cannot.** Everything the API can
 * tell us is whether a ruleset reports `UP`. The error people actually hit —
 * "This ruleset is temporarily unavailable" — is produced by the game's own
 * login and character-creation services, which are a different system from the
 * web API this reads, and the two have disagreed. Two other messages that look
 * like the same fault are not faults at all: a PvP faction locked for
 * population balance, and creation throttled under load. None of those three
 * appears in any field this command can see.
 *
 * So every message says *the ruleset is not reporting UP*, and the card always
 * carries the caveat. A monitor that claims more than it knows gets muted the
 * first time it is wrong, and the one thing worse than no monitor is a monitor
 * nobody believes.
 */

const CAVEAT =
  "This is the Battle.net API's view of the ruleset, not of the login servers. " +
  "A faction lock or throttled creation produces the same message in game and is invisible here.";

/**
 * `/wowforever status`.
 *
 * An empty reading is reported as empty rather than as healthy: "no rulesets"
 * is what an unreachable or unconfigured API looks like, and calling that
 * "everything is fine" would be the worst possible answer.
 */
async function status(context: CommandContext) {
  const { snapshots, error } = await pollForeverRulesets(
    foreverCredentials(process.env)
  );

  if (error)
    return context.reply({
      title: "WoW: Forever rulesets",
      description: `I could not check the rulesets.\n\n${error}`,
      tone: "error",
      footer: CAVEAT,
    });

  if (!snapshots.length)
    return context.reply({
      title: "WoW: Forever rulesets",
      description:
        "The API returned no rulesets at all, so there is nothing to report either way.",
      tone: "error",
      footer: CAVEAT,
    });

  const summary = summarizeRulesets(snapshots);
  const notUp = summary.notUp
    .map((entry) => {
      const shown = entry.raw
        ? ` — reported ${entry.raw}`
        : " — no status reported";
      return `${entry.name}${shown}`;
    })
    .join("\n");

  return context.reply({
    title: "WoW: Forever rulesets",
    description:
      summary.down || summary.unknown
        ? `${summary.up} of ${summary.total} reporting up.\n\n${notUp}`
        : `All ${summary.total} rulesets are reporting up.`,
    tone: summary.down ? "error" : "info",
    footer: CAVEAT,
  });
}

/** `/wowforever watch` — bind this channel for announcements. */
async function watch(context: CommandContext) {
  const { i, guild, member, config } = context;
  if (!member.permissions.has(PermissionFlagsBits.ManageGuild))
    return context.reply({
      title: "WoW: Forever watch",
      description: "You need the Manage Server permission to change this.",
      tone: "error",
    });

  const next = {
    ...config,
    wowForever: { ...config.wowForever, channelId: i.channelId ?? "" },
  };
  await saveConfig(guild.id, next, {
    id: member.id,
    name: member.user.tag,
    avatar: member.user.displayAvatarURL(),
  });
  logger.info(
    { guildId: guild.id, channelId: i.channelId },
    "WoW Forever watch set"
  );
  return context.reply({
    title: "WoW: Forever watch",
    description:
      "I'll post here when a ruleset stops reporting up, and again when it comes back.",
    tone: "info",
    footer: CAVEAT,
  });
}

/** `/wowforever unwatch`. */
async function unwatch(context: CommandContext) {
  const { guild, member, config } = context;
  if (!member.permissions.has(PermissionFlagsBits.ManageGuild))
    return context.reply({
      title: "WoW: Forever watch",
      description: "You need the Manage Server permission to change this.",
      tone: "error",
    });

  const next = {
    ...config,
    wowForever: { ...config.wowForever, channelId: "" },
  };
  await saveConfig(guild.id, next, {
    id: member.id,
    name: member.user.tag,
    avatar: member.user.displayAvatarURL(),
  });
  return context.reply({
    title: "WoW: Forever watch",
    description: "Stopped announcing ruleset changes.",
    tone: "info",
  });
}

export async function wowForeverCommand(context: CommandContext) {
  switch (context.i.options.getSubcommand()) {
    case "watch":
      return watch(context);
    case "unwatch":
      return unwatch(context);
    default:
      return status(context);
  }
}
