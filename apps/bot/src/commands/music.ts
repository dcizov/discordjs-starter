import type { CommandContext } from "./context";
import type { MusicService } from "../features/music/service";
import { musicActionCard, queueCard } from "../interactions/replies";
import { searchResultComponents } from "../features/music/search-session";

export async function musicCommand(
  context: CommandContext,
  music: MusicService
) {
  const { i, guild, member, reply } = context;

  switch (i.commandName) {
    case "queue": {
      const state = music.state(guild.id);
      // The voice channel and queue limit come from real guild/config state; a
      // bot that is not connected says so instead of inventing a channel.
      const limits = await music.limits(guild.id);
      await reply(
        queueCard(state, {
          voiceChannel: guild.members.me?.voice?.channel?.name ?? null,
          queueLimit: limits.maxQueue,
        })
      );
      break;
    }
    /**
     * Quick play stays the default: a title or link is resolved and queued
     * immediately. `/search` is the explicit alternative for listeners who
     * want to see the candidates instead of accepting the first result.
     */
    case "search": {
      const query = i.options.getString("query", true);
      const tracks = await music.search(member, query, 5);
      if (!tracks.length) {
        await reply(
          "No tracks matched that search on the configured sources. Try a different title or paste a supported link."
        );
        break;
      }
      const session = music.searches.create({
        guildId: guild.id,
        userId: member.id,
        tracks,
      });
      await i.editReply({
        content: `**Results for “${query.slice(0, 100)}”** — choose what to queue. This menu works once and expires in 2 minutes.`,
        allowedMentions: { parse: [] },
        components: searchResultComponents(session),
      });
      break;
    }
    case "play":
    case "pause":
    case "resume":
    case "skip":
    case "stop":
    case "volume":
    case "shuffle":
    case "repeat":
    case "seek": {
      await music.action(member, {
        action: i.commandName,
        query: i.options.getString("query") ?? undefined,
        volume: i.options.getInteger("level") ?? undefined,
        position: i.options.getInteger("position") ?? undefined,
        repeat: (i.options.getString("mode") ?? undefined) as
          "off" | "track" | "queue" | undefined,
      });
      await reply(musicActionCard(i.commandName, music.state(guild.id)));
      break;
    }
  }
}
