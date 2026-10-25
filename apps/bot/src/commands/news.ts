import type { CommandContext } from "./context";
import { PermissionFlagsBits } from "discord.js";
import { listResources } from "@orbit/db";
import { pollSourceDetailed } from "@orbit/core/feeds";
import { newsCard } from "@orbit/core/news-presentation";
import { replyLabel } from "../interactions/replies";
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
        const { items, notices } = await pollSourceDetailed(source);
        const cards = items
          .slice(0, 3)
          .map((item) => newsCard(item, { sourceName: source.name }));
        await reply({
          title: `A test flight from ${source.name}`,
          description: `Source reached. ${items.length} recent item${items.length === 1 ? "" : "s"}. Nothing was delivered. These cards use the same formatting as live delivery.`,
          tone: "info",
          fields: cards.length
            ? cards.map((card) => ({
                name: replyLabel(card.title, 120),
                value: [
                  card.excerpt || "No description supplied by the source.",
                  card.url || "No article link supplied by the source.",
                  card.attribution === "unknown" ? "" : card.attributionLabel,
                ]
                  .filter(Boolean)
                  .join("\n")
                  .slice(0, 1000),
              }))
            : [{ name: "No recent items", value: "Nothing to preview yet." }],
          footer: notices[0] ? notices[0].slice(0, 200) : undefined,
        });
      }
      break;
    }
  }
}
