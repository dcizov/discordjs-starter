import { escapeMarkdown, type APIEmbed } from "discord.js";
import type { GameDeal, DealMoney } from "./deal-types";
import { providerUrl } from "./itad";
import { safeText } from "./safety";
import { steamReview } from "./deal-policy";
const label = (value: string, max = 100) =>
  escapeMarkdown(safeText(value, max), { maskedLink: true }).slice(0, max * 2);
export function dealMoney(money: DealMoney) {
  return `${money.amount} ${money.currency}`;
}
/** Used by slash replies AND the persistent delivery worker: same real data. */
export function dealEmbed(result: GameDeal, compact = false): APIEmbed {
  const { game, offer } = result;
  if (game.mature !== false || game.type !== "game")
    throw new Error(
      "Only verified non-mature base-game metadata can be displayed."
    );
  const fields: NonNullable<APIEmbed["fields"]> = [];
  if (offer) {
    fields.push({
      name: offer.cut > 0 ? `Save ${offer.cut}%` : "Current price",
      value:
        `**${dealMoney(offer.price)}**${offer.regular && offer.cut > 0 ? ` · was ${dealMoney(offer.regular)}` : ""}\n${label(offer.shop.name, 60)}`.slice(
          0,
          220
        ),
      inline: true,
    });
    if (offer.historicalLow)
      fields.push({
        name: offer.atHistoricalLow ? "At historical low" : "Historical low",
        value: dealMoney(offer.historicalLow),
        inline: true,
      });
    if (offer.voucher)
      fields.push({
        name: "Voucher required",
        value: escapeMarkdown(offer.voucher, { maskedLink: true }),
        inline: true,
      });
  } else
    fields.push({
      name: "Price unavailable",
      value: `No current ${result.country} offer in the selected currency was returned. This does not mean it is free.`,
      inline: false,
    });
  const steam = steamReview(game.reviews);
  if (steam?.score != null)
    fields.push({
      name: "Steam reviews",
      value: `${steam.score}% positive${steam.count != null ? ` · ${steam.count.toLocaleString("en-US")} reviews` : " · review count unavailable"}`,
      inline: true,
    });
  else
    fields.push({
      name: "Steam reviews",
      value: "Rating unavailable",
      inline: true,
    });
  if (!compact)
    for (const review of game.reviews
      .filter((review) => review !== steam && review.score != null)
      .slice(0, 2))
      fields.push({
        name: label(review.source, 60),
        value: `${review.score}/100${review.count != null ? ` · ${review.count.toLocaleString("en-US")} ratings` : ""}`,
        inline: true,
      });
  if (game.players)
    fields.push({
      name: "Recent Steam players · ITAD",
      value: game.players.recent.toLocaleString("en-US"),
      inline: true,
    });
  if (game.popularRank != null)
    fields.push({
      name: "ITAD popularity position",
      value: `#${game.popularRank} · waitlists + collections`,
      inline: true,
    });
  if (!compact && game.developers.length)
    fields.push({
      name: "Developer",
      value: game.developers
        .slice(0, 2)
        .map((developer) => label(developer, 70))
        .join(", ")
        .slice(0, 220),
      inline: true,
    });
  if (!compact && offer?.platforms.length)
    fields.push({
      name: "Platforms / DRM",
      value: [...offer.platforms, ...offer.drm]
        .slice(0, 6)
        .map((name) => label(name, 24))
        .join(" · ")
        .slice(0, 220),
      inline: true,
    });
  if (offer?.expiry)
    fields.push({
      name: "Offer expiry",
      value: `<t:${Math.floor(Date.parse(offer.expiry) / 1000)}:R>`,
      inline: true,
    });
  const url = providerUrl(game.url) || providerUrl(offer?.url);
  const image = providerUrl(game.image, true),
    boxart = providerUrl(game.boxart, true);
  return {
    title: safeText(game.title, 180),
    ...(url ? { url } : {}),
    description:
      [
        "Base game",
        game.releaseDate ? label(game.releaseDate, 16) : "",
        ...game.tags.slice(0, compact ? 3 : 5).map((tag) => label(tag, 24)),
      ]
        .filter(Boolean)
        .join(" · ")
        .slice(0, 280) + `\nGame ID: \`${game.id}\``,
    color: offer?.atHistoricalLow ? 0x43c59e : 0x8b5cf6,
    ...(image ? { image: { url: image } } : {}),
    ...(!compact && boxart ? { thumbnail: { url: boxart } } : {}),
    fields: fields.slice(0, compact ? 6 : 12),
    footer: {
      text: `Data: IsThereAnyDeal · ${result.country} · Not affiliated · Verify final price/terms at the shop.`,
    },
    ...(Number.isFinite(Date.parse(result.checkedAt))
      ? { timestamp: result.checkedAt }
      : {}),
  };
}

export function dealLinkRow(result: GameDeal) {
  const components: Array<{ type: 2; style: 5; label: string; url: string }> =
    [];
  const offer = providerUrl(result.offer?.url),
    game = providerUrl(result.game.url);
  if (offer)
    components.push({
      type: 2,
      style: 5,
      label: `View offer · ${result.offer!.shop.name}`.slice(0, 80),
      url: offer,
    });
  if (game)
    components.push({
      type: 2,
      style: 5,
      label: "Compare on IsThereAnyDeal",
      url: game,
    });
  return components.length ? { type: 1 as const, components } : null;
}
