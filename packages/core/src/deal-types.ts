export type GameReview = {
  source: string;
  score: number | null;
  count: number | null;
  url: string;
};
export type DealGame = {
  id: string;
  title: string;
  slug: string;
  type: string | null;
  mature: boolean | null;
  image: string;
  boxart: string;
  url: string;
  reviews: GameReview[];
  tags: string[];
  developers: string[];
  releaseDate: string | null;
  players: { recent: number; day: number; week: number; peak: number } | null;
  popularRank?: number; // Position from the public most-popular endpoint, NOT live players.
};
export type DealMoney = { amount: number; amountInt: number; currency: string };
export type GameOffer = {
  shop: { id: number; name: string };
  price: DealMoney;
  regular: DealMoney | null;
  cut: number;
  url: string;
  voucher: string | null;
  expiry: string | null;
  historicalLow: DealMoney | null;
  atHistoricalLow: boolean;
  platforms: string[];
  drm: string[];
};
export type GameDeal = {
  game: DealGame;
  offer: GameOffer | null;
  country: string;
  checkedAt: string;
};
