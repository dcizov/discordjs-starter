// Fictional offline fixtures. No live price/rating claims or provider requests.
import type { GameDeal } from "../../packages/core/src/deal-types";
export const gameId = "12000000-0000-4000-8000-000000000001";
export const otherId = "12000000-0000-4000-8000-000000000002";
export const rawGame = (id = gameId, extra: Record<string, any> = {}) => ({
  id,
  title: "Fictional popular test game",
  slug: "test-game",
  type: "game",
  mature: false,
  assets: {
    banner600: "https://assets.example.com/banner.jpg",
    boxart: "https://assets.example.com/box.jpg",
  },
  ...extra,
});
export const rawInfo = (id = gameId, extra: Record<string, any> = {}) => ({
  ...rawGame(id),
  reviews: [
    {
      source: "Steam",
      score: 90,
      count: 50000,
      url: "https://store.example.com/reviews",
    },
    {
      source: "Metascore",
      score: 87,
      count: 30,
      url: "https://critics.example.com/test",
    },
  ],
  tags: ["Strategy"],
  releaseDate: "2020-01-01",
  developers: [{ name: "Test studio" }],
  players: { recent: 1200, day: 2000, week: 4000, peak: 100000 },
  urls: { game: "https://isthereanydeal.com/game/test-game/" },
  ...extra,
});
export const rawOffer = (extra: Record<string, any> = {}) => ({
  shop: { id: 61, name: "Test shop" },
  price: { amount: 10, amountInt: 1000, currency: "EUR" },
  regular: { amount: 40, amountInt: 4000, currency: "EUR" },
  cut: 75,
  url: "https://itad.link/test?affiliate=retained&tag=a%2Fb",
  voucher: null,
  expiry: null,
  historyLow: { amount: 10, amountInt: 1000, currency: "EUR" },
  drm: [{ id: 61, name: "Steam" }],
  platforms: [{ id: 1, name: "Windows" }],
  timestamp: "2026-10-24T10:00:00Z",
  ...extra,
});
export function deal(id = gameId): GameDeal {
  return {
    game: {
      id,
      title: "Fictional popular test game",
      slug: "test-game",
      type: "game",
      mature: false,
      image: "https://assets.example.com/banner.jpg",
      boxart: "https://assets.example.com/box.jpg",
      url: "https://isthereanydeal.com/game/test-game/",
      reviews: [
        {
          source: "Steam",
          score: 90,
          count: 50000,
          url: "https://store.example.com/reviews",
        },
      ],
      tags: ["Strategy"],
      developers: ["Test studio"],
      releaseDate: "2020-01-01",
      popularRank: 10,
      players: { recent: 1200, day: 2000, week: 4000, peak: 100000 },
    },
    offer: {
      shop: { id: 61, name: "Test shop" },
      price: { amount: 10, amountInt: 1000, currency: "EUR" },
      regular: { amount: 40, amountInt: 4000, currency: "EUR" },
      cut: 75,
      url: "https://itad.link/test?affiliate=retained&tag=a%2Fb",
      voucher: null,
      expiry: null,
      historicalLow: { amount: 10, amountInt: 1000, currency: "EUR" },
      atHistoricalLow: true,
      platforms: ["Windows"],
      drm: ["Steam"],
    },
    country: "DE",
    checkedAt: new Date().toISOString(),
  };
}
export const policy = {
  gameId: "",
  region: "DE",
  currency: "EUR",
  minDiscount: 50,
  maxPrice: 60,
  stores: [],
  historicalLow: false,
  minReviews: 10000,
  minScore: 70,
  maxPopularityRank: 500,
  minPlayers: 0,
  maxPostsPerCheck: 3,
};
