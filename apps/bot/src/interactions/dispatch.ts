import {
  MessageFlags,
  type Client,
  type Interaction,
  type REST,
} from "discord.js";
import { audit, getGuild } from "@orbit/db";
import { errorDiagnostic } from "@orbit/core/diagnostics";
import { logger } from "@orbit/core/logger";
import type { MusicService } from "../features/music/service";
import { handleRoleInteraction } from "../features/roles/panels";
import { dispatchCommand } from "../commands/dispatch";
import { handleAutocomplete } from "./autocomplete";
import { commandErrorReply, commandReply, type ReplyCard } from "./replies";
export async function onInteraction(
  client: Client,
  music: MusicService,
  i: Interaction,
  communityRest?: Pick<REST, "get" | "post">
) {
  if (!i.guild) return;
  try {
    if (i.isButton() || i.isStringSelectMenu()) {
      if (i.customId.startsWith("role:")) await handleRoleInteraction(i);
      return;
    }
    if (i.isAutocomplete()) {
      await handleAutocomplete(i);
      return;
    }
    if (!i.isChatInputCommand()) return;
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const guild = i.guild;
    const member = await guild.members.fetch({ user: i.user.id, force: true });
    const stored = await getGuild(guild.id);
    if (!stored)
      throw new Error(
        "Orbit is still syncing this community. Please try again in a moment."
      );
    const reply = (content: string | ReplyCard) =>
      i.editReply(commandReply(i.commandName, content));
    await dispatchCommand(
      { i, guild, member, config: stored.config, reply },
      client,
      music,
      communityRest
    );
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
        { id: i.user.id, name: i.user.displayName, avatar: i.user.avatar },
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
