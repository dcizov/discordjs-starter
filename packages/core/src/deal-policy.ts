import type { GameDeal, GameReview } from "./deal-types";

/** Explicit, configurable proxies for widely known games — not an AAA/indie label. */
export const DEAL_QUALITY_DEFAULTS = {
  maxPopularityRank: 500,
  minReviews: 10000,
  minScore: 70,
  minPlayers: 0,
  maxPostsPerCheck: 3,
} as const;
export function dealQuality(data: Record<string, any>) {
  return {
    maxPopularityRank:
      data.maxPopularityRank ?? DEAL_QUALITY_DEFAULTS.maxPopularityRank,
    minReviews: data.minReviews ?? DEAL_QUALITY_DEFAULTS.minReviews,
    minScore: data.minScore ?? DEAL_QUALITY_DEFAULTS.minScore,
    minPlayers: data.minPlayers ?? DEAL_QUALITY_DEFAULTS.minPlayers,
    maxPostsPerCheck:
      data.maxPostsPerCheck ?? DEAL_QUALITY_DEFAULTS.maxPostsPerCheck,
  };
}
export function steamReview(reviews: GameReview[]) {
  return reviews.find((review) => review.source.toLowerCase() === "steam");
}
export function eligibleDeal(
  result: GameDeal,
  data: Record<string, any>,
  now = Date.now()
) {
  const { game, offer } = result;
  if (result.country !== data.region) return false;
  if (game.type !== "game" || game.mature !== false || !offer || !offer.url)
    return false;
  if (offer.expiry && new Date(offer.expiry).getTime() <= now) return false;
  if (
    offer.price.currency !== data.currency ||
    offer.price.amount > data.maxPrice ||
    offer.cut <= 0 ||
    offer.cut < data.minDiscount
  )
    return false;
  if (data.stores?.length && !data.stores.includes(offer.shop.id)) return false;
  if (data.historicalLow && !offer.atHistoricalLow) return false;
  // A deliberate single-game watch is an explicit choice, not a discovery feed.
  if (data.gameId) return data.gameId === game.id;
  const quality = dealQuality(data),
    review = steamReview(game.reviews);
  return (
    game.popularRank != null &&
    game.popularRank > 0 &&
    game.popularRank <= quality.maxPopularityRank &&
    review?.count != null &&
    review.count >= quality.minReviews &&
    review.score != null &&
    review.score >= quality.minScore &&
    (!quality.minPlayers ||
      (game.players != null && game.players.recent >= quality.minPlayers))
  );
}

export function assertDeliverableDeal(
  result: GameDeal | undefined,
  data: Record<string, any>,
  now = Date.now()
) {
  const checked = result ? Date.parse(result.checkedAt) : NaN;
  if (
    !result ||
    !Number.isFinite(checked) ||
    now - checked > 86400000 ||
    checked > now + 300000 ||
    !eligibleDeal(result, data, now)
  )
    throw new Error(
      "Deal is expired, unverified, stale, or no longer meets this subscription's current popularity/price filters. Recheck the feed for a fresh offer."
    );
}
