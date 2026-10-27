import {
  Events,
  type Client,
  type ClientEvents,
  type Guild,
  type REST,
} from "discord.js";
import { logger } from "@orbit/core/logger";
import { errorDiagnostic } from "@orbit/core/diagnostics";
import { onInteraction } from "../interactions/dispatch";
import { onMessage } from "../features/moderation/messages";
import { handleReaction } from "../features/roles/panels";
import type { MusicService } from "../features/music/service";
import { removeGuild, syncGuild } from "../infrastructure/guild-sync";
import {
  recordDeparture,
  recordMember,
  syncRoster,
} from "../infrastructure/roster-sync";

/** Installs only Orbit's application listeners; disposal never removes SDK/voice listeners. */
export function attachGatewayEvents(
  client: Client,
  music: MusicService,
  rest: Pick<REST, "get" | "post">
) {
  const dispose: (() => void)[] = [];
  function listen<K extends keyof ClientEvents>(
    event: K,
    handler: (...args: ClientEvents[K]) => void
  ) {
    client.on(event, handler);
    dispose.push(() => client.off(event, handler));
  }
  function sync(guild: Guild) {
    void syncGuild(guild).catch((error) =>
      logger.warn(
        { guildId: guild.id, error: errorDiagnostic(error) },
        "Guild metadata sync failed"
      )
    );
  }
  listen(Events.InteractionCreate, (interaction) => {
    void onInteraction(client, music, interaction, rest).catch((error) =>
      logger.error(
        { error: errorDiagnostic(error) },
        "Interaction handler failed"
      )
    );
  });
  listen(Events.MessageCreate, (message) => {
    void onMessage(message).catch((error) =>
      logger.error(
        { guildId: message.guildId, error: errorDiagnostic(error) },
        "Message handling failed"
      )
    );
  });
  listen(Events.MessageReactionAdd, (reaction, user) => {
    void handleReaction(reaction, user, true).catch((error) =>
      logger.warn({ error: errorDiagnostic(error) }, "Reaction role failed")
    );
  });
  listen(Events.MessageReactionRemove, (reaction, user) => {
    void handleReaction(reaction, user, false).catch((error) =>
      logger.warn(
        { error: errorDiagnostic(error) },
        "Reaction role removal failed"
      )
    );
  });
  listen(Events.GuildCreate, (guild) => {
    sync(guild);
    // A fresh install has no roster copy at all; read it once, bounded.
    void syncRoster(guild, "installed").catch((error) =>
      logger.warn(
        { guildId: guild.id, error: errorDiagnostic(error) },
        "Initial roster sync failed"
      )
    );
  });
  listen(Events.GuildUpdate, (_before, guild) => sync(guild));
  listen(Events.GuildDelete, (guild) => {
    // No pending music timer may outlive Orbit's membership of the guild.
    void music
      .guildRemoved(guild.id)
      .catch((error) =>
        logger.warn(
          { guildId: guild.id, error: errorDiagnostic(error) },
          "Music cleanup for a removed guild failed"
        )
      );
    void removeGuild(guild.id).catch((error) =>
      logger.warn(
        { error: errorDiagnostic(error) },
        "Guild removal sync failed"
      )
    );
  });
  listen(Events.GuildRoleCreate, (role) => sync(role.guild));
  listen(Events.GuildRoleUpdate, (_before, role) => sync(role.guild));
  listen(Events.GuildRoleDelete, (role) => sync(role.guild));
  listen(Events.ChannelCreate, (channel) => {
    if ("guild" in channel) sync(channel.guild);
  });
  listen(Events.ChannelUpdate, (_before, channel) => {
    if ("guild" in channel) sync(channel.guild);
  });
  listen(Events.ChannelDelete, (channel) => {
    if ("guild" in channel) sync(channel.guild);
  });
  listen(Events.GuildMemberUpdate, (_before, member) => {
    // Orbit's own membership carries the role position and permissions the
    // dashboard shows, so it still refreshes guild metadata.
    if (member.id === client.user?.id) sync(member.guild);
    // Nickname, role, avatar or guild-avatar changes for anyone else are exactly
    // what makes a stale roster wrong in the members screen.
    void recordMember(member).catch((error) =>
      logger.warn(
        {
          guildId: member.guild.id,
          userId: member.id,
          error: errorDiagnostic(error),
        },
        "Member update could not be recorded"
      )
    );
  });
  listen(Events.GuildMemberAdd, (member) => {
    void recordMember(member).catch((error) =>
      logger.warn(
        {
          guildId: member.guild.id,
          userId: member.id,
          error: errorDiagnostic(error),
        },
        "Member join could not be recorded"
      )
    );
  });
  listen(Events.GuildMemberRemove, (member) => {
    void recordDeparture(member).catch((error) =>
      logger.warn(
        {
          guildId: member.guild.id,
          userId: member.id,
          error: errorDiagnostic(error),
        },
        "Member departure could not be recorded"
      )
    );
  });
  return () => {
    for (const remove of dispose) remove();
  };
}
