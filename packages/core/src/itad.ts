import { z } from "zod";
import { isDemo, required } from "./config";
import { officialJson } from "./integration-http";
import { isPublicAddress, safeText } from "./safety";
import { isIP } from "node:net";
import type { DealGame, GameDeal, GameOffer } from "./deal-types";

const text = z.string().max(4000);
const gameSchema = z.object({
  id: z.string().uuid(),
  title: text,
  slug: text.default(""),
  type: z.enum(["game", "dlc", "package"]).nullable().default(null),
  mature: z.boolean().nullable().default(null),
  assets: z.record(z.string(), text.nullable()).default({}),
});
const reviewSchema = z.object({
  source: text,
  score: z.number().min(0).max(100).nullable(),
  count: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  url: text,
});
const infoSchema = gameSchema.extend({
  reviews: z.array(reviewSchema).max(30).default([]),
  tags: z.array(text).max(100).default([]),
  releaseDate: text.nullable().default(null),
  developers: z
    .array(z.object({ name: text }))
    .max(50)
    .default([]),
  players: z
    .object({
      recent: z.number().nonnegative(),
      day: z.number().nonnegative(),
      week: z.number().nonnegative(),
      peak: z.number().nonnegative(),
    })
    .nullable()
    .default(null),
  urls: z.object({ game: text }).optional(),
});
const moneySchema = z.object({
  amount: z.number().finite().nonnegative(),
  amountInt: z.number().int().nonnegative(),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
const named = z.object({ id: z.number().int().positive(), name: text });
const offerSchema = z.object({
  shop: named,
  price: moneySchema,
  regular: moneySchema.nullable().default(null),
  cut: z.number().int().min(0).max(100),
  url: text,
  voucher: z.string().max(256).nullable().default(null),
  expiry: text.nullable().default(null),
  historyLow: moneySchema.nullable().default(null),
  flag: text.nullable().default(null),
  drm: z.array(named).max(30).default([]),
  platforms: z.array(named).max(30).default([]),
});
export type RawOffer = z.infer<typeof offerSchema>;
export function providerUrl(value: string | null | undefined, images = false) {
  if (!value || value.length > 2000 || /[\u0000-\u0020<>`]/.test(value))
    return "";
  try {
    const url = new URL(value);
    if (
      !(images ? ["https:"] : ["https:", "http:"]).includes(url.protocol) ||
      url.username ||
      url.password
    )
      return "";
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (
      value.trim() !== value ||
      host === "localhost" ||
      !host.includes(".") ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      (isIP(host) && !isPublicAddress(host))
    )
      return "";
    // Do not reserialize, remove affiliate parameters, or truncate ITAD links.
    return value;
  } catch {
    return "";
  }
}
function providerImage(...values: Array<string | null | undefined>) {
  return values.map((value) => providerUrl(value, true)).find(Boolean) ?? "";
}
export function normalizeOffer(
  input: unknown,
  fallbackLow?: unknown
): GameOffer | null {
  const parsed = offerSchema.safeParse(input);
  if (!parsed.success) return null;
  const value = parsed.data,
    url = providerUrl(value.url);
  if (!url || (value.expiry && !Number.isFinite(Date.parse(value.expiry))))
    return null;
  const candidateLow = moneySchema.safeParse(value.historyLow ?? fallbackLow);
  const low =
    candidateLow.success && candidateLow.data.currency === value.price.currency
      ? candidateLow.data
      : null;
  return {
    shop: { id: value.shop.id, name: safeText(value.shop.name, 80) },
    price: value.price,
    regular:
      value.regular?.currency === value.price.currency ? value.regular : null,
    cut: value.cut,
    url,
    voucher: value.voucher,
    expiry: value.expiry,
    historicalLow: low,
    atHistoricalLow: low != null && value.price.amountInt <= low.amountInt,
    platforms: value.platforms.map((platform) => safeText(platform.name, 40)),
    drm: value.drm.map((drm) => safeText(drm.name, 40)),
  };
}

type JsonTransport = (url: string, init?: RequestInit) => Promise<any>;
/** Public documented endpoints only; no internal player/review APIs or scraping. */
export class ITADClient {
  private cache = new Map<string, { expires: number; value: any }>();
  private pending = new Map<string, Promise<any>>();
  private retryAt = 0;
  private active = 0;
  private waiters: Array<() => void> = [];
  constructor(
    private key: string,
    private transport: JsonTransport = officialJson,
    private now: () => number = Date.now
  ) {
    if (isDemo() && transport === officialJson)
      throw new Error("Live IsThereAnyDeal requests are disabled in demo mode");
  }
  private async limited<T>(run: () => Promise<T>) {
    if (this.active >= 4)
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    else this.active++;
    try {
      return await run();
    } finally {
      const next = this.waiters.shift();
      if (next)
        next(); // transfer the slot; do not let a new caller steal it
      else this.active--;
    }
  }
  private read(
    path: string,
    params: Record<string, string>,
    ttlMs: number,
    body?: string
  ): Promise<any> {
    if (isDemo() && this.transport === officialJson)
      return Promise.reject(
        new Error("Live IsThereAnyDeal requests are disabled in demo mode")
      );
    const query = new URLSearchParams(params);
    query.sort();
    const url = `https://api.isthereanydeal.com${path}${query.size ? `?${query}` : ""}`;
    const cacheKey = `${url}|${body ?? ""}`,
      entry = this.cache.get(cacheKey);
    if (entry && entry.expires > this.now())
      return Promise.resolve(entry.value);
    if (this.pending.has(cacheKey)) return this.pending.get(cacheKey)!;
    const pending = this.limited(async () => {
      if (this.retryAt > this.now())
        throw Object.assign(
          new Error(
            "IsThereAnyDeal is rate limited; wait for the provider's Retry-After window."
          ),
          { status: 429, retryAfterMs: this.retryAt - this.now() }
        );
      try {
        const value = await this.transport(url, {
          headers: {
            "ITAD-API-Key": this.key,
            ...(body ? { "content-type": "application/json" } : {}),
          },
          ...(body ? { method: "POST", body } : {}),
        });
        if (this.cache.size >= 1000)
          this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(cacheKey, { expires: this.now() + ttlMs, value });
        return value;
      } catch (error: any) {
        if (error.status === 429)
          this.retryAt =
            this.now() +
            Math.max(1000, Math.min(error.retryAfterMs ?? 60000, 86400000));
        throw error;
      }
    }).finally(() => this.pending.delete(cacheKey));
    this.pending.set(cacheKey, pending);
    return pending;
  }
  async search(query: string) {
    if (query.trim().length < 2 || query.length > 100)
      throw new Error("Enter 2–100 characters of a game title.");
    const result = z
      .array(gameSchema)
      .max(100)
      .parse(
        await this.read(
          "/games/search/v1",
          { title: query.trim(), results: "15" },
          300000
        )
      );
    return result
      .filter((game) => game.type === "game" && game.mature !== true)
      .map((game) => ({
        id: game.id,
        title: safeText(game.title, 150),
        slug: game.slug,
        image: providerImage(game.assets.banner300, game.assets.boxart),
      }));
  }
  async info(id: string): Promise<DealGame> {
    z.string().uuid().parse(id);
    const data = infoSchema.parse(
      await this.read("/games/info/v2", { id }, 3600000)
    );
    if (data.id !== id)
      throw new Error("IsThereAnyDeal returned metadata for a different game.");
    return {
      id: data.id,
      title: safeText(data.title, 200),
      slug: data.slug,
      type: data.type,
      mature: data.mature,
      image: providerImage(
        data.assets.banner600,
        data.assets.banner400,
        data.assets.boxart
      ),
      boxart: providerUrl(data.assets.boxart, true),
      url: providerUrl(data.urls?.game),
      reviews: data.reviews.map((review) => ({
        ...review,
        source: safeText(review.source, 60),
        url: providerUrl(review.url),
      })),
      tags: data.tags.map((tag) => safeText(tag, 40)),
      developers: data.developers.map((developer) =>
        safeText(developer.name, 80)
      ),
      releaseDate: data.releaseDate,
      players: data.players,
    };
  }
  async popular(): Promise<Map<string, number>> {
    const rows = z
      .array(
        gameSchema.extend({
          position: z.number().int().min(1),
          count: z.number().nonnegative(),
        })
      )
      .max(500)
      .parse(
        await this.read(
          "/stats/most-popular/v1",
          { limit: "500", offset: "0" },
          3600000
        )
      );
    return new Map(
      rows
        .filter((row) => row.type === "game" && row.mature === false)
        .map((row) => [row.id, row.position])
    );
  }
  async prices(
    ids: string[],
    country: string,
    stores: number[] = []
  ): Promise<Map<string, GameOffer[]>> {
    if (!ids.length) return new Map();
    z.array(z.string().uuid()).max(200).parse(ids);
    if (!/^[A-Z]{2}$/.test(country))
      throw new Error("Choose an ISO two-letter country.");
    const params: Record<string, string> = {
      country,
      capacity: "5",
      vouchers: "true",
    };
    if (stores.length) params.shops = stores.join(",");
    const rows = z
      .array(
        z.object({
          id: z.string().uuid(),
          deals: z.array(z.unknown()).max(100),
          historyLow: z.object({ all: moneySchema.nullable() }).optional(),
        })
      )
      .max(200)
      .parse(
        await this.read(
          "/games/prices/v3",
          params,
          60000,
          JSON.stringify([...new Set(ids)].sort())
        )
      );
    return new Map(
      rows
        .filter((row) => ids.includes(row.id))
        .map((row) => [
          row.id,
          row.deals
            .map((offer) => normalizeOffer(offer, row.historyLow?.all))
            .filter((offer): offer is GameOffer => !!offer),
        ])
    );
  }
  async dealList(data: Record<string, any>, offset = 0) {
    const params: Record<string, string> = {
      country: data.region,
      limit: "200",
      offset: String(offset),
      nondeals: "false",
      mature: "false",
      sort: "-cut",
      // The documented filter is FLAT. filter.mature accepts only true, so the
      // actual mature exclusion belongs to the top-level mature=false parameter.
      filter: JSON.stringify({
        type: [1],
        cut: { min: data.minDiscount, max: null },
        price: { min: 0, max: data.maxPrice },
        steamCount: { min: data.minReviews, max: null },
        steamPerc: { min: data.minScore, max: null },
      }),
    };
    if (data.stores?.length) params.shops = data.stores.join(",");
    return z
      .object({
        list: z.array(gameSchema.extend({ deal: z.unknown() })).max(200),
        hasMore: z.boolean(),
        nextOffset: z.number().int().nonnegative(),
      })
      .parse(await this.read("/deals/v2", params, 300000));
  }
  async searchDeals(
    query: string,
    country: string,
    currency: string,
    limit = 3
  ): Promise<GameDeal[]> {
    const ids = new Set<string>();
    const found = (await this.search(query))
      .filter((game) => {
        if (ids.has(game.id)) return false;
        ids.add(game.id);
        return true;
      })
      .slice(0, Math.min(5, Math.max(1, limit)));
    const [games, prices] = await Promise.all([
      Promise.all(found.map((game) => this.info(game.id))),
      this.prices(
        found.map((game) => game.id),
        country
      ),
    ]);
    return games
      .filter((game) => game.mature === false && game.type === "game")
      .map((game) => ({
        game,
        offer:
          (prices.get(game.id) ?? [])
            .filter(
              (offer) =>
                offer.price.currency === currency &&
                (!offer.expiry || Date.parse(offer.expiry) > this.now())
            )
            .sort((a, b) => a.price.amountInt - b.price.amountInt)[0] ?? null,
        country,
        checkedAt: new Date(this.now()).toISOString(),
      }));
  }
}
let live: ITADClient | undefined, configuredKey: string | undefined;
export function liveITAD() {
  if (isDemo())
    throw new Error("Live IsThereAnyDeal requests are disabled in demo mode");
  const key = required("ITAD_API_KEY");
  if (!live || configuredKey !== key) {
    live = new ITADClient(key);
    configuredKey = key;
  }
  return live;
}
