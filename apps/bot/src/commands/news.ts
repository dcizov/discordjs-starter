import type { CommandContext } from "./context";
import { PermissionFlagsBits } from "discord.js";
import { listResources } from "@orbit/db";
import { pollSource } from "@orbit/core/feeds";
export async function newsCommand(context: CommandContext) {
  const { i, guild, member, config, reply } = context;

  switch (i.commandName) {
    case "news": {
      if (!config.modules.news) throw new Error("News aggregation is paused.");
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
  }
}
