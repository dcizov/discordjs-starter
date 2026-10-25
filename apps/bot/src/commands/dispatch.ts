import type { CommandContext } from "./context";
import type { Client, REST } from "discord.js";
import type { MusicService } from "../features/music/service";
import { communityCommand } from "./community";
import { economyCommand } from "./economy";
import { moderationCommand } from "./moderation";
import { rolesCommand } from "./roles";
import { musicCommand } from "./music";
import { newsCommand } from "./news";
import { handleDeals } from "../features/deals/commands";

/** Fixed command set: direct imports/routing, no discovery or registration side effects. */
export async function dispatchCommand(
  context: CommandContext,
  client: Client,
  music: MusicService,
  communityRest?: Pick<REST, "get" | "post">
) {
  switch (context.i.commandName) {
    case "poll":
    case "announce":
      return communityCommand(context, client, communityRest);
    case "transactions":
    case "balance":
    case "daily":
    case "transfer":
    case "leaderboard":
    case "shop":
    case "inventory":
      return economyCommand(context);
    case "warn":
    case "timeout":
    case "kick":
    case "ban":
    case "purge":
    case "cases":
      return moderationCommand(context);
    case "roles":
    case "role-panel":
      return rolesCommand(context, client);
    case "queue":
    case "play":
    case "pause":
    case "resume":
    case "skip":
    case "stop":
    case "volume":
    case "shuffle":
    case "repeat":
      return musicCommand(context, music);
    case "deals":
      return handleDeals(context.i, context.member);
    case "news":
      return newsCommand(context);
    case "ping":
      return context.reply(
        `Orbit is here. Gateway: ${client.ws.ping}ms. Configuration is live.`
      );
    default:
      return context.reply(
        "That command is not available. Try /roles, /daily, /shop, or /play."
      );
  }
}
