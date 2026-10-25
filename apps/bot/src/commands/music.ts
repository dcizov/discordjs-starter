import type { CommandContext } from "./context";
import type { MusicService } from "../features/music/service";
import { musicActionCard, queueCard } from "../interactions/replies";
export async function musicCommand(
  context: CommandContext,
  music: MusicService
) {
  const { i, guild, member, reply } = context;

  switch (i.commandName) {
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
  }
}
