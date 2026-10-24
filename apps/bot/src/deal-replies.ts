import type { InteractionReplyOptions } from "discord.js";
import type { GameDeal } from "@orbit/core/deal-types";
import { dealEmbed, dealLinkRow } from "@orbit/core/deal-presentation";
export function gameDealReply(results: GameDeal[], detailed = false) {
  const games = results.slice(0, 3);
  return {
    content: "",
    embeds: games.map((game) => dealEmbed(game, !detailed)),
    components: games.flatMap((game) => {
      const row = dealLinkRow(game);
      return row ? [row] : [];
    }),
    allowedMentions: { parse: [] },
  } satisfies InteractionReplyOptions;
}
