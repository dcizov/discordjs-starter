import { createHash } from "node:crypto";
import type { FeedItem, Resource } from "./types";
import type { GameDeal } from "./deal-types";
import { dealQuality, eligibleDeal } from "./deal-policy";
import { ITADClient, liveITAD, normalizeOffer } from "./itad";
import { safeText } from "./safety";

export const dealCountryCurrencies: Record<string, string> = {
  DE: "EUR",
  US: "USD",
  GB: "GBP",
  CA: "CAD",
  AU: "AUD",
};
export function searchGames(query: string) {
  return liveITAD().search(query);
}
export function searchGameDeals(query: string, country = "DE", limit = 3) {
  return liveITAD().searchDeals(
    query,
    country,
    dealCountryCurrencies[country] ?? "EUR",
    limit
  );
}
export async function gameDealInfo(
  id: string,
  country = "DE"
): Promise<GameDeal> {
  const api = liveITAD(),
    game = await api.info(id);
  if (game.mature !== false || game.type !== "game")
    throw new Error(
      "This item is not a verified non-mature base game. DLC, bundles and mature/unknown content are excluded."
    );
  const prices = await api.prices([id], country);
  const currency = dealCountryCurrencies[country] ?? "EUR";
  const offer =
    (prices.get(id) ?? [])
      .filter(
        (offer) =>
          offer.price.currency === currency &&
          (!offer.expiry || Date.parse(offer.expiry) > Date.now())
      )
      .sort((a, b) => a.price.amountInt - b.price.amountInt)[0] ?? null;
  return { game, offer, country, checkedAt: new Date().toISOString() };
}
export function dealItem(result: GameDeal): FeedItem {
  const offer = result.offer!;
  // ITAD refresh timestamps can change with no offer change. Do not repost the
  // same sale every poll. Known expiry distinguishes later recurring campaigns.
  const signature = [
    result.game.id,
    offer.shop.id,
    offer.price.currency,
    offer.price.amountInt,
    offer.voucher ?? "",
    offer.expiry ?? "",
  ].join("|");
  return {
    id: `itad-${createHash("sha256").update(signature).digest("hex")}`,
    title: result.game.title,
    url: offer.url,
    summary: `${offer.price.amount} ${offer.price.currency} · ${offer.cut}% off at ${safeText(offer.shop.name, 80)}`,
    price: offer.price.amount,
    currency: offer.price.currency,
    discount: offer.cut,
    storeId: offer.shop.id,
    historicalLow: offer.atHistoricalLow,
    publishedAt: result.checkedAt,
    tags: ["Deals"],
    deal: result,
  };
}

/** General discovery is fail-closed: no "sort by 100% off" obscurity fallback. */
export async function collectDeals(
  source: Resource,
  api: ITADClient
): Promise<FeedItem[]> {
  const data: Record<string, any> = {
    region: "DE",
    currency: "EUR",
    maxPrice: 60,
    minDiscount: 50,
    ...source.data,
    ...dealQuality(source.data),
  };
  if (data.gameId) {
    const game = await api.info(data.gameId);
    if (game.mature !== false || game.type !== "game") return [];
    const offers =
      (await api.prices([game.id], data.region, data.stores)).get(game.id) ??
      [];
    const results = offers
      .map((offer): GameDeal => ({
        game,
        offer,
        country: data.region,
        checkedAt: new Date().toISOString(),
      }))
      .filter((result) => eligibleDeal(result, data));
    results.sort((a, b) => a.offer!.price.amountInt - b.offer!.price.amountInt);
    return results.length ? [dealItem(results[0])] : [];
  }
  const popular = await api.popular();
  const candidates = new Map<
    string,
    { rank: number; offer: NonNullable<GameDeal["offer"]> }
  >();
  let offset = 0;
  // Bounded two-page discovery; native review filters are rechecked against
  // authoritative game metadata, not trusted as a substitute for real evidence.
  for (let page = 0; page < 2; page++) {
    const response = await api.dealList(data, offset);
    for (const row of response.list) {
      const rank = popular.get(row.id),
        offer = normalizeOffer(row.deal);
      if (
        rank == null ||
        rank > data.maxPopularityRank ||
        !offer ||
        row.type !== "game" ||
        row.mature === true ||
        candidates.has(row.id)
      )
        continue;
      candidates.set(row.id, { rank, offer });
    }
    if (
      candidates.size >= 40 ||
      !response.hasMore ||
      response.nextOffset <= offset
    )
      break;
    offset = response.nextOffset;
  }
  const selected = [...candidates]
    .sort((a, b) => a[1].rank - b[1].rank)
    .slice(0, 40);
  const results = await Promise.all(
    selected.map(async ([id, candidate]): Promise<GameDeal> => ({
      game: { ...(await api.info(id)), popularRank: candidate.rank },
      offer: candidate.offer,
      country: data.region,
      checkedAt: new Date().toISOString(),
    }))
  );
  return results.filter((result) => eligibleDeal(result, data)).map(dealItem);
}
export function pollDeals(source: Resource) {
  return collectDeals(source, liveITAD());
}
