import { escapeMarkdown, type APIEmbed } from "discord.js";
import type { GameDeal, DealMoney } from "./deal-types";
import { providerUrl } from "./itad";
import { safeText } from "./safety";
import { steamReview } from "./deal-policy";
const label = (value: string, max = 100) =>
  escapeMarkdown(safeText(value, max), { maskedLink: true }).slice(0, max * 2);

export function dealMoney(money: DealMoney) {
  const formatted = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: money.currency,
  }).format(money.amount);
  // Never silently truncate a financial amount into a different price.
  return formatted.length <= 64 ? formatted : "Price unavailable (see shop)";
}
function releaseDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? new Intl.DateTimeFormat("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(date)
    : "";
}
function takeLink(url: string, seen?: Set<string>) {
  if (!url || seen?.has(url)) return "";
  seen?.add(url);
  return url;
}

/**
 * Shared by slash replies and persistent delivery. Information density and
 * artwork size are independent. Existing channel consumers keep their default;
 * slash search cards opt into large artwork while retaining concise fields.
 * Links stay with their game, never in detached rows below multiple embeds.
 */
export function dealEmbed(
  result: GameDeal,
  compact = false,
  seenLinks?: Set<string>,
  options: { artwork?: "large" | "compact" } = {}
): APIEmbed {
  const { game, offer } = result;
  if (game.mature !== false || game.type !== "game")
    throw new Error(
      "Only verified non-mature base-game metadata can be displayed."
    );
  const comparison = providerUrl(game.url);
  const url = takeLink(comparison, seenLinks);
  const fields: NonNullable<APIEmbed["fields"]> = [];
  if (offer) {
    const shop = `Shop at ${label(offer.shop.name, 60)}`;
    const lines = [
      `**${dealMoney(offer.price)}**${offer.regular && offer.cut > 0 ? `  ~~${dealMoney(offer.regular)}~~` : ""}${offer.cut > 0 ? `  ·  **${offer.cut}% off**` : ""}`,
      shop,
      ...(offer.historicalLow
        ? [
            `Recorded low: **${dealMoney(offer.historicalLow)}**${offer.atHistoricalLow ? " · **low-price match**" : ""}`,
          ]
        : []),
      ...(offer.voucher
        ? [
            `**Code required:** ${escapeMarkdown(offer.voucher, { maskedLink: true })}`,
          ]
        : []),
      ...(offer.expiry && Number.isFinite(Date.parse(offer.expiry))
        ? [`Ends <t:${Math.floor(Date.parse(offer.expiry) / 1000)}:R>`]
        : []),
    ];
    const offerUrl = providerUrl(offer.url);
    // Link-button URLs are limited to 512 characters. A longer original URL
    // may still fit in a field; never cut/rewrite affiliate parameters.
    if (
      (compact || offerUrl.length > 512) &&
      offerUrl &&
      offerUrl !== comparison &&
      !seenLinks?.has(offerUrl)
    ) {
      const link = `[${shop} ↗](<${offerUrl}>)`;
      const length = lines.join("\n").length - shop.length + link.length;
      if (length <= 1024) {
        lines[1] = link;
        seenLinks?.add(offerUrl);
      } else
        lines[1] +=
          " · Offer URL too long to display; compare via the game title.";
    }
    fields.push({
      name: "Current offer",
      value: lines.join("\n"),
      inline: false,
    });
  } else
    fields.push({
      name: "Price unavailable",
      value: `No current ${result.country} offer in the selected currency was returned. This does not mean it is free.`,
      inline: false,
    });

  if (
    offer &&
    offer.price.amountInt > 0 &&
    game.tags.some((tag) => /^free[ -]+to[ -]+play$/i.test(tag.trim()))
  )
    fields.push({
      name: "Catalog / offer note",
      value:
        "“Free to Play” is a catalog tag, not this offer’s price. The shop may sell a paid package containing the game. Check included products at the linked store.",
      inline: false,
    });

  const steam = steamReview(game.reviews);
  const community = [
    steam?.score != null
      ? `**${steam.score}% positive**${steam.count != null ? ` · ${steam.count.toLocaleString("en-US")} reviews` : " · review count unavailable"}`
      : "Rating unavailable",
    ...(game.players
      ? [
          `**${game.players.recent.toLocaleString("en-US")}** recent Steam players · ITAD snapshot`,
        ]
      : []),
    ...(game.popularRank != null
      ? [`ITAD popularity: **#${game.popularRank}** · waitlists + collections`]
      : []),
  ];
  fields.push({
    name: "Steam community",
    value: community.join("\n"),
    inline: false,
  });
  if (!compact) {
    for (const review of game.reviews
      .filter((review) => review !== steam && review.score != null)
      .slice(0, 2))
      fields.push({
        name: label(review.source, 60),
        value: `**${review.score}/100**${review.count != null ? ` · ${review.count.toLocaleString("en-US")} ratings` : ""}`,
        inline: false,
      });
    const details: string[] = [];
    if (game.developers.length)
      details.push(
        `**Developer:** ${game.developers
          .slice(0, 2)
          .map((developer) => label(developer, 70))
          .join(", ")}`
      );
    const platforms = [
      ...new Set([...(offer?.platforms ?? []), ...(offer?.drm ?? [])]),
    ]
      .filter(Boolean)
      .slice(0, 6);
    if (platforms.length)
      details.push(
        `**Platforms / DRM:** ${platforms.map((name) => label(name, 24)).join(" · ")}`
      );
    if (details.length)
      fields.push({
        name: "Game details",
        value: details.join("\n"),
        inline: false,
      });
  }
  // Keep API/watch/dedup identities out of ALL user-facing deal text.
  const released = releaseDate(game.releaseDate);
  const image = providerUrl(game.image, true),
    boxart = providerUrl(game.boxart, true);
  const large = options.artwork === "large";
  const artwork = large
    ? image || boxart
    : options.artwork === "compact"
      ? ""
      : !compact
        ? image
        : "";
  const thumbnail = artwork
    ? ""
    : options.artwork === "compact"
      ? boxart || image
      : compact
        ? boxart || image
        : boxart;
  const coverFallback = large && artwork && (!image || image === boxart);
  return {
    title: safeText(game.title, 180),
    ...(url ? { url } : {}),
    description: [
      `Base game${released ? ` · Released **${released}**` : ""}`,
      game.tags.length
        ? `Tags: ${[...new Set(game.tags)]
            .slice(0, compact ? 3 : 5)
            .map((tag) => label(tag, 24))
            .join(" · ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
    color: offer?.atHistoricalLow ? 0x43c59e : 0x8b5cf6,
    ...(artwork ? { image: { url: artwork } } : {}),
    ...(thumbnail ? { thumbnail: { url: thumbnail } } : {}),
    fields,
    footer: {
      text: `IsThereAnyDeal · ${result.country} · Check shop price/terms · Not affiliated${coverFallback ? " · Cover artwork" : ""}`,
    },
    ...(Number.isFinite(Date.parse(result.checkedAt))
      ? { timestamp: result.checkedAt }
      : {}),
  };
}

/** The title is the comparison link; never add that same page as another button. */
export function dealLinkRow(result: GameDeal, seenLinks = new Set<string>()) {
  const offer = providerUrl(result.offer?.url),
    comparison = providerUrl(result.game.url);
  if (
    !offer ||
    offer.length > 512 ||
    offer === comparison ||
    seenLinks.has(offer)
  )
    return null;
  seenLinks.add(offer);
  return {
    type: 1 as const,
    components: [
      {
        type: 2 as const,
        style: 5 as const,
        label: safeText(`Shop at ${result.offer!.shop.name}`, 80),
        url: offer,
      },
    ],
  };
}
