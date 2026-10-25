import { describe, expect, it, vi } from "vitest";
import {
  appArtworkFromStore,
  isSteamImageUrl,
  SteamArtworkCache,
  steamAppdetailsUrl,
  steamArtworkEnabled,
} from "@orbit/core/steam-artwork";
import { mapSteamNews, withSteamAppArtwork } from "@orbit/core/feeds";
import { feedEmbed, newsCard } from "@orbit/core/news-presentation";
import type { FeedItem } from "@orbit/core/types";

/**
 * Steam app artwork is a *fallback*: the news API has no image field, so the
 * only supported sources are (1) an image inside the article body and (2) the
 * game's store header/capsule image, labelled as app artwork.
 *
 * Recorded-response evidence: the fixtures under `tests/fixtures/steam/` have no
 * image key. The `appdetails` payloads below are trimmed to the documented
 * fields we read (`success`, `data.name`, `data.header_image`,
 * `data.capsule_image`) and are not presented as recorded provider output.
 */

const APP_ID = 570;

const headerPayload = {
  "570": {
    success: true,
    data: {
      name: "Dota 2",
      header_image:
        "https://cdn.cloudflare.steamstatic.com/steam/apps/570/header.jpg",
      capsule_image:
        "https://cdn.cloudflare.steamstatic.com/steam/apps/570/capsule_231x87.jpg",
    },
  },
};

function item(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: "gid-1",
    title: "The Summer Event has arrived",
    url: "https://store.steampowered.com/news/app/570/view/1",
    summary: "Body text.",
    publishedAt: "2026-10-24T10:00:00.000Z",
    tags: ["Steam"],
    attribution: "official",
    sourceLabel: "Dota 2",
    ...overrides,
  };
}

describe("Steam app artwork mapping", () => {
  it("reads the documented store fields and prefers the header image", () => {
    expect(appArtworkFromStore(headerPayload, APP_ID)).toEqual({
      appId: APP_ID,
      appName: "Dota 2",
      url: "https://cdn.cloudflare.steamstatic.com/steam/apps/570/header.jpg",
      kind: "app-header",
    });
  });

  it("falls back to the capsule image when there is no header image", () => {
    const artwork = appArtworkFromStore(
      {
        "570": {
          success: true,
          data: {
            name: "Dota 2",
            capsule_image: headerPayload["570"].data.capsule_image,
          },
        },
      },
      APP_ID
    );
    expect(artwork?.kind).toBe("app-capsule");
  });

  it("omits artwork for an unsuccessful or unrelated payload", () => {
    expect(
      appArtworkFromStore({ "570": { success: false } }, APP_ID)
    ).toBeNull();
    expect(
      appArtworkFromStore({ "730": headerPayload["570"] }, APP_ID)
    ).toBeNull();
    expect(appArtworkFromStore(null, APP_ID)).toBeNull();
    expect(appArtworkFromStore("nope", APP_ID)).toBeNull();
  });

  it("refuses image hosts outside Steam's CDNs and non-image URLs", () => {
    expect(
      isSteamImageUrl(
        "https://cdn.cloudflare.steamstatic.com/steam/apps/570/header.jpg"
      )
    ).toBe(true);
    // Lookalike host: must not pass a substring check.
    expect(
      isSteamImageUrl("https://cdn.cloudflare.steamstatic.com.evil.test/a.jpg")
    ).toBe(false);
    expect(isSteamImageUrl("https://cs.rin.ru/steam/570/header.jpg")).toBe(
      false
    );
    // An HTML page is not an image, even on a Steam host.
    expect(
      isSteamImageUrl(
        "https://cdn.cloudflare.steamstatic.com/steam/apps/570/header"
      )
    ).toBe(false);
    expect(
      isSteamImageUrl(
        "https://cdn.cloudflare.steamstatic.com/steam/apps/570/header.jpg?x=1#y"
      )
    ).toBe(true);
  });

  it("drops an unsafe store field instead of returning it", () => {
    const artwork = appArtworkFromStore(
      {
        "570": {
          success: true,
          data: { name: "Dota 2", header_image: "javascript:alert(1)" },
        },
      },
      APP_ID
    );
    expect(artwork).toBeNull();
  });

  it("only requests the basic filter for one app id", () => {
    const url = new URL(steamAppdetailsUrl(APP_ID));
    expect(url.host).toBe("store.steampowered.com");
    expect(url.pathname).toBe("/api/appdetails");
    expect(url.searchParams.get("appids")).toBe("570");
    expect(url.searchParams.get("filters")).toBe("basic");
  });
});

describe("SteamArtworkCache", () => {
  it("looks a game up once, even for concurrent callers", async () => {
    const transport = vi.fn(async () => headerPayload);
    const cache = new SteamArtworkCache({ transport });
    const [a, b] = await Promise.all([cache.get(APP_ID), cache.get(APP_ID)]);
    expect(a?.kind).toBe("app-header");
    expect(b).toBe(a);
    await cache.get(APP_ID);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("serves the cached value until the TTL expires", async () => {
    let now = 0;
    const transport = vi.fn(async () => headerPayload);
    const cache = new SteamArtworkCache({
      transport,
      now: () => now,
      ttlMs: 1000,
    });
    await cache.get(APP_ID);
    now = 999;
    await cache.get(APP_ID);
    expect(transport).toHaveBeenCalledTimes(1);
    now = 1001;
    await cache.get(APP_ID);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("caches failures briefly so a store outage is not retried every poll", async () => {
    let now = 0;
    const transport = vi.fn(async () => {
      throw new Error("503");
    });
    const cache = new SteamArtworkCache({
      transport,
      now: () => now,
      failureTtlMs: 600,
    });
    expect(await cache.get(APP_ID)).toBeNull();
    now = 599;
    expect(await cache.get(APP_ID)).toBeNull();
    expect(transport).toHaveBeenCalledTimes(1);
    now = 601;
    await cache.get(APP_ID);
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it("stays bounded and ignores impossible app ids", async () => {
    const transport = vi.fn(async () => headerPayload);
    const cache = new SteamArtworkCache({ transport, maxEntries: 2 });
    await cache.get(1);
    await cache.get(2);
    await cache.get(3);
    expect(await cache.get(0)).toBeNull();
    expect(await cache.get(-5)).toBeNull();
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it("can be disabled from configuration", () => {
    expect(
      steamArtworkEnabled({ STEAM_APP_ARTWORK: "false" } as NodeJS.ProcessEnv)
    ).toBe(false);
    expect(
      steamArtworkEnabled({ STEAM_APP_ARTWORK: " FALSE " } as NodeJS.ProcessEnv)
    ).toBe(false);
    expect(steamArtworkEnabled({} as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe("withSteamAppArtwork", () => {
  const cache = {
    get: vi.fn(async () => appArtworkFromStore(headerPayload, APP_ID)),
  };

  it("never overrides an image the article itself carried", async () => {
    const article = item({
      image: "https://clan.cloudflare.steamstatic.com/images/x.jpg",
    });
    const { items, used } = await withSteamAppArtwork([article], APP_ID, {
      cache,
    });
    expect(used).toBe(false);
    expect(items[0]).toBe(article);
    expect(cache.get).not.toHaveBeenCalled();
  });

  it("labels a store image as app artwork, not article imagery", async () => {
    const { items, used, appName } = await withSteamAppArtwork(
      [item()],
      APP_ID,
      { cache }
    );
    expect(used).toBe(true);
    expect(appName).toBe("Dota 2");
    expect(items[0].image).toBe(
      "https://cdn.cloudflare.steamstatic.com/steam/apps/570/header.jpg"
    );
    expect(items[0].imageKind).toBe("app-artwork");
    expect(items[0].imageAttribution).toBe("Dota 2 · Steam store artwork");
  });

  it("adds provenance to every image-less item", async () => {
    const { items } = await withSteamAppArtwork(
      [item(), item({ id: "b" })],
      APP_ID,
      {
        cache,
      }
    );
    expect(items.map((i) => i.imageKind)).toEqual([
      "app-artwork",
      "app-artwork",
    ]);
  });

  it("leaves items text-only when the store lookup fails", async () => {
    const { items, used } = await withSteamAppArtwork([item()], APP_ID, {
      cache: { get: async () => null },
    });
    expect(used).toBe(false);
    expect(items[0].image).toBeUndefined();
  });

  it("honours the kill switch without contacting the store", async () => {
    const get = vi.fn();
    const { items, used } = await withSteamAppArtwork([item()], APP_ID, {
      cache: { get },
      enabled: false,
    });
    expect(used).toBe(false);
    expect(get).not.toHaveBeenCalled();
    expect(items[0].image).toBeUndefined();
  });

  it("does nothing for an empty page", async () => {
    const get = vi.fn();
    expect(await withSteamAppArtwork([], APP_ID, { cache: { get } })).toEqual({
      items: [],
      used: false,
      appName: "",
    });
    expect(get).not.toHaveBeenCalled();
  });
});

describe("artwork provenance in the card and the Discord embed", () => {
  it("marks the card image as store artwork and says so", () => {
    const card = newsCard(
      item({
        image:
          "https://cdn.cloudflare.steamstatic.com/steam/apps/570/header.jpg",
        imageKind: "app-artwork",
        imageAttribution: "Dota 2 · Steam store artwork",
      })
    );
    expect(card.imageKind).toBe("app-artwork");
    expect(card.imageAttribution).toBe("Dota 2 · Steam store artwork");
    expect(card.notices.join(" ")).toContain(
      "not a picture supplied by this article"
    );
  });

  it("keeps article imagery unlabelled", () => {
    const card = newsCard(
      item({
        image: "https://clan.cloudflare.steamstatic.com/images/1.jpg",
        imageKind: "article",
      })
    );
    expect(card.imageKind).toBe("article");
    expect(card.imageAttribution).toBe("");
    expect(card.notices.join(" ")).not.toContain("store artwork");
  });

  it("names store artwork in the embed footer", () => {
    const embed = feedEmbed(
      item({
        image:
          "https://cdn.cloudflare.steamstatic.com/steam/apps/570/header.jpg",
        imageKind: "app-artwork",
      })
    );
    expect(embed.image?.url).toBe(
      "https://cdn.cloudflare.steamstatic.com/steam/apps/570/header.jpg"
    );
    expect(embed.footer.text).toContain("Store artwork");
    expect(embed.footer.text.length).toBeLessThanOrEqual(1024);
  });

  it("leaves no image fields when nothing was supplied", () => {
    const card = newsCard(item());
    const embed = feedEmbed(item());
    expect(card.imageKind).toBeNull();
    expect(embed.image).toBeUndefined();
    expect(embed.footer.text).not.toContain("Store artwork");
  });
});

describe("mapSteamNews still reports what the provider did not send", () => {
  it("keeps article markup images and adds no image of its own", () => {
    const { items } = mapSteamNews([
      {
        gid: "1",
        title: "Event",
        url: "https://store.steampowered.com/news/app/570/view/1",
        contents: "[img]{STEAM_CLAN_IMAGE}/123/art.png[/img] body",
        date: 1_760_000_000,
        feedlabel: "Dota 2",
        feed_type: 1,
      },
    ]);
    expect(items[0].image).toBe(
      "https://clan.cloudflare.steamstatic.com/images/123/art.png"
    );
    expect(items[0].imageKind).toBe("article");
  });
});
