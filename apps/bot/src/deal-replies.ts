import type { InteractionReplyOptions } from "discord.js";
import type { GameDeal } from "@orbit/core/deal-types";
import { dealEmbed, dealLinkRow } from "@orbit/core/deal-presentation";
export function gameDealReply(results: GameDeal[], detailed = false) {
  const ids = new Set<string>();
  const games = results
    .filter(({ game }) => {
      if (ids.has(game.id)) return false;
      ids.add(game.id);
      return true;
    })
    .slice(0, detailed ? 1 : 3);
  const links = new Set<string>();
  const embeds = games.map((game) =>
    dealEmbed(game, !detailed, links, { artwork: "large" })
  );
  // Discord positions ALL action rows after ALL embeds, not beneath each card.
  // Search/preview links live in the corresponding card. Only a single detailed
  // result gets a shop button; its title already links to the comparison page.
  const row = detailed && games[0] ? dealLinkRow(games[0], links) : null;
  return {
    content: "",
    embeds,
    components: row ? [row] : [],
    allowedMentions: { parse: [] },
  } satisfies InteractionReplyOptions;
}
