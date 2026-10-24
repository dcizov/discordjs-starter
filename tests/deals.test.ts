import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ITADClient,
  liveITAD,
  normalizeOffer,
  providerUrl,
} from "../packages/core/src/itad";
import {
  assertDeliverableDeal,
  eligibleDeal,
} from "../packages/core/src/deal-policy";
import { collectDeals, dealItem } from "../packages/core/src/deals";
import { dealSchema } from "../packages/core/src/config";
import { upstreamError } from "../packages/core/src/integration-http";
import {
  deal,
  gameId,
  otherId,
  policy,
  rawGame,
  rawInfo,
  rawOffer,
} from "./fixtures/deals";
import type { Resource } from "../packages/core/src/types";

afterEach(() => vi.unstubAllEnvs());
describe("documented public ITAD transport", () => {
  it("uses v2 info, v3 batched prices and a server-only header, never a URL key", async () => {
    const transport = vi.fn(async (input: string, _init?: RequestInit) =>
      input.includes("/info/v2")
        ? rawInfo()
        : [
            {
              id: gameId,
              deals: [rawOffer()],
              historyLow: { all: rawOffer().historyLow },
            },
          ]
    );
    const api = new ITADClient("fixture-secret-key", transport);
    const info = await api.info(gameId);
    expect(info.image).toBe("https://assets.example.com/banner.jpg");
    const prices = await api.prices([gameId], "DE");
    expect(prices.get(gameId)![0].url).toBe(rawOffer().url);
    for (const [url, init] of transport.mock.calls) {
      expect(url).not.toContain("fixture-secret-key");
      expect(url).not.toMatch(/[?&]key=/);
      expect(init!.headers).toMatchObject({
        "ITAD-API-Key": "fixture-secret-key",
      });
    }
    expect(transport.mock.calls[1][1]).toMatchObject({
      method: "POST",
      body: JSON.stringify([gameId]),
    });
    expect(transport.mock.calls[1][0]).not.toContain("shops=");
  });
  it("deduplicates concurrent lookups and caches them instead of maxing provider quota", async () => {
    const transport = vi.fn(async () => rawInfo());
    const api = new ITADClient("fixture", transport);
    await Promise.all([api.info(gameId), api.info(gameId), api.info(gameId)]);
    await api.info(gameId);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("honors Retry-After across other queued requests, with no retry loop", async () => {
    let now = 100000;
    const transport = vi
      .fn()
      .mockRejectedValueOnce(upstreamError(429, "60"))
      .mockResolvedValue(rawInfo());
    const api = new ITADClient("fixture", transport, () => now);
    await expect(api.info(gameId)).rejects.toMatchObject({ status: 429 });
    await expect(api.info(otherId)).rejects.toMatchObject({ status: 429 });
    expect(transport).toHaveBeenCalledTimes(1);
    now += 60001;
    await expect(api.info(gameId)).resolves.toMatchObject({ id: gameId });
  });
  it("does not label null ratings/players as zero, free, or currently playing", async () => {
    const api = new ITADClient("fixture", async () =>
      rawInfo(gameId, {
        players: null,
        reviews: [
          {
            source: "Steam",
            score: null,
            count: null,
            url: "https://store.example.com/",
          },
        ],
      })
    );
    const game = await api.info(gameId);
    expect(game.players).toBeNull();
    expect(game.reviews[0].score).toBeNull();
    expect(game.reviews[0].count).toBeNull();
  });
  it("rejects mismatched metadata and malformed API responses instead of guessing", async () => {
    await expect(
      new ITADClient("fixture", async () => rawInfo(otherId)).info(gameId)
    ).rejects.toThrow("different game");
    await expect(
      new ITADClient("fixture", async () => ({
        title: "missing identifier",
      })).info(gameId)
    ).rejects.toThrow();
  });
  it("does not search DLC or marked-mature results as base games", async () => {
    const api = new ITADClient("fixture", async () => [
      rawGame(),
      rawGame(otherId, { type: "dlc" }),
      rawGame(otherId, { mature: true }),
    ]);
    expect(await api.search("test game")).toHaveLength(1);
  });
  it("uses the documented FLAT filters and top-level mature=false (not an invented false-only filter)", async () => {
    const transport = vi.fn(async (_input: string, _init?: RequestInit) => ({
      list: [],
      nextOffset: 0,
      hasMore: false,
    }));
    await new ITADClient("fixture", transport).dealList({
      ...policy,
      ...{ region: "DE" },
    });
    const url = new URL(transport.mock.calls[0][0]);
    const filter = JSON.parse(url.searchParams.get("filter")!);
    expect(filter).toMatchObject({
      steamCount: { min: 10000, max: null },
      steamPerc: { min: 70, max: null },
      type: [1],
    });
    expect(filter).not.toHaveProperty("reviews");
    expect(filter).not.toHaveProperty("mature");
    expect(url.searchParams.get("mature")).toBe("false");
  });
  it("rechecks demo isolation even if a live client was constructed before a mode change", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    const api = new ITADClient("fixture-key-not-sent");
    vi.stubEnv("DEMO_MODE", "true");
    await expect(api.info(gameId)).rejects.toThrow("disabled in demo");
  });
  it("requires explicit live mode and a key; demo never sends requests", () => {
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("ITAD_API_KEY", "fixture");
    expect(() => liveITAD()).toThrow("disabled in demo");
    expect(() => new ITADClient("fixture")).toThrow("disabled in demo");
  });
});

describe("evidence-based discovery, not obscure discount spam", () => {
  it("requires popularity AND real review evidence, while letting popular indies qualify", () => {
    expect(eligibleDeal(deal(), policy)).toBe(true);
    for (const mutate of [
      (d: ReturnType<typeof deal>) => {
        delete d.game.popularRank;
      },
      (d: ReturnType<typeof deal>) => {
        d.game.popularRank = 501;
      },
      (d: ReturnType<typeof deal>) => {
        d.game.reviews[0].count = 12;
      },
      (d: ReturnType<typeof deal>) => {
        d.game.reviews[0].score = 50;
      },
      (d: ReturnType<typeof deal>) => {
        d.game.reviews = [];
      },
      (d: ReturnType<typeof deal>) => {
        d.game.mature = true;
      },
      (d: ReturnType<typeof deal>) => {
        d.game.mature = null;
      },
      (d: ReturnType<typeof deal>) => {
        d.game.type = "dlc";
      },
      (d: ReturnType<typeof deal>) => {
        d.country = "US";
      },
      (d: ReturnType<typeof deal>) => {
        d.offer!.price.currency = "USD";
      },
      (d: ReturnType<typeof deal>) => {
        d.offer!.expiry = "2000-01-01T00:00:00Z";
      },
    ]) {
      const candidate = deal();
      mutate(candidate);
      expect(eligibleDeal(candidate, policy)).toBe(false);
    }
    const indie = deal();
    indie.game.title = "A genuinely popular indie";
    expect(eligibleDeal(indie, policy)).toBe(true);
  });
  it("allows explicit single-game watches outside discovery but still excludes mature/DLC/expired data", () => {
    const candidate = deal();
    delete candidate.game.popularRank;
    candidate.game.reviews = [];
    expect(eligibleDeal(candidate, { ...policy, gameId })).toBe(true);
    candidate.game.mature = true;
    expect(eligibleDeal(candidate, { ...policy, gameId })).toBe(false);
  });
  it("supports an optional recent-player floor and fails closed if it is unavailable", () => {
    const candidate = deal();
    candidate.game.players = null;
    expect(eligibleDeal(candidate, policy)).toBe(true);
    expect(eligibleDeal(candidate, { ...policy, minPlayers: 100 })).toBe(false);
  });
  it("rejects old/future/unknown delivery timestamps and rechecks current subscription filters", () => {
    const candidate = deal();
    assertDeliverableDeal(candidate, policy);
    for (const date of ["not-a-date", "2000-01-01", "2099-01-01"]) {
      candidate.checkedAt = date;
      expect(() => assertDeliverableDeal(candidate, policy)).toThrow("stale");
    }
    expect(() =>
      assertDeliverableDeal(deal(), { ...policy, minReviews: 1000000 })
    ).toThrow("filters");
  });
  it("never falls back to the arbitrary deal list when the popularity service fails", async () => {
    const transport = vi.fn(async (_input: string, _init?: RequestInit) => {
      throw new Error("Popularity unavailable");
    });
    const api = new ITADClient("fixture", transport);
    const source = { kind: "deal", data: policy } as unknown as Resource;
    await expect(collectDeals(source, api)).rejects.toThrow(
      "Popularity unavailable"
    );
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][0]).toContain("/stats/most-popular/v1");
  });
  it("intersects a deep-discount list with actual ranked IDs and enriches only eligible candidates", async () => {
    const transport = vi.fn(async (input: string, _init?: RequestInit) => {
      if (input.includes("/most-popular/"))
        return [{ ...rawGame(), position: 10, count: 100000 }];
      if (input.includes("/deals/v2"))
        return {
          list: [
            { ...rawGame(), deal: rawOffer() },
            { ...rawGame(otherId), deal: rawOffer({ cut: 100 }) },
          ],
          hasMore: false,
          nextOffset: 2,
        };
      if (input.includes("/games/info/")) return rawInfo();
      throw new Error("Unexpected endpoint");
    });
    const result = await collectDeals(
      { kind: "deal", data: policy } as unknown as Resource,
      new ITADClient("fixture", transport)
    );
    expect(result).toHaveLength(1);
    expect(result[0].deal!.game.popularRank).toBe(10);
    expect(transport.mock.calls.some(([url]) => url.includes(otherId))).toBe(
      false
    );
  });
  it("backfills conservative defaults for old subscriptions and bounds posting/quality inputs", () => {
    const data = dealSchema.parse({ name: "Popular games", data: {} }).data;
    expect(data).toMatchObject({
      minReviews: 10000,
      minScore: 70,
      maxPopularityRank: 500,
      maxPostsPerCheck: 3,
    });
    for (const input of [
      { minReviews: 1 },
      { maxPopularityRank: 99999 },
      { maxPostsPerCheck: 100 },
    ])
      expect(() => dealSchema.parse({ name: "Bad", data: input })).toThrow();
  });
});

describe("unaltered links, real price data, stable event identity", () => {
  it("retains affiliate URLs byte-for-byte and does not count missing/cross-currency lows as records", () => {
    expect(normalizeOffer(rawOffer())!.url).toBe(rawOffer().url);
    expect(
      normalizeOffer(rawOffer({ historyLow: null }))!.atHistoricalLow
    ).toBe(false);
    expect(
      normalizeOffer(
        rawOffer({
          historyLow: { amount: 20, amountInt: 2000, currency: "USD" },
        })
      )!.atHistoricalLow
    ).toBe(false);
    expect(
      normalizeOffer(
        rawOffer({ price: { amount: 0, amountInt: 0, currency: "EUR" } })
      )!.price.amount
    ).toBe(0);
  });
  it("does not make a new post for an unchanged price just because ITAD refreshed timestamps", () => {
    const first = dealItem(deal());
    const next = deal();
    next.checkedAt = new Date(Date.now() + 1000).toISOString();
    expect(dealItem(next).id).toBe(first.id);
    next.offer!.price = { amount: 8, amountInt: 800, currency: "EUR" };
    expect(dealItem(next).id).not.toBe(first.id);
  });
  it.each([
    "https://localhost/",
    "https://172.16.0.1/",
    "https://u:secret@shop.example/",
    "javascript:alert(1)",
    "https://shop.example/a\npath",
  ])("excludes unsafe embed destinations %s", (url) => {
    expect(providerUrl(url)).toBe("");
  });
});
