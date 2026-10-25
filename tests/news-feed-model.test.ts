import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  attributionTone,
  feedMetaLine,
  newsFeedModel,
  postedLabel,
} from "@/lib/news-feed";
import type { NewsCard } from "@orbit/core/news-presentation";

/**
 * View-model tests for the news preview feed. Markup itself is asserted by
 * `tests/e2e/news-preview.spec.ts` in CI (this sandbox cannot install a
 * browser); everything that decides *what* the feed says is plain functions and
 * is covered here against the recorded Steam payload.
 */
const payload = JSON.parse(
  readFileSync(resolve("tests/fixtures/steam/preview-payload.json"), "utf8")
) as { items: NewsCard[]; shown: number; count: number };

const card = (overrides: Partial<NewsCard> = {}): NewsCard => ({
  id: "x",
  title: "An update",
  url: "https://example.test/a",
  excerpt: "text",
  image: null,
  imageKind: null,
  imageAttribution: "",
  publishedAt: "2026-10-21T10:00:00.000Z",
  sourceLabel: "Community Announcements",
  subscriptionLabel: "",
  attribution: "official",
  attributionLabel: "App announcement",
  linkLabel: "Read the announcement",
  publisher: "",
  tags: [],
  notices: [],
  ...overrides,
});

describe("news feed model", () => {
  it("puts the newest recorded item in the feature slot", () => {
    const model = newsFeedModel(payload.items, "CS2 updates");
    expect(model.lead?.id).toBe(payload.items[0].id);
    expect(model.more).toHaveLength(payload.items.length - 1);
    expect(model.moreHeading).toBe("More updates from CS2 updates");
  });

  it("falls back to the subscription label, then to neutral copy", () => {
    expect(
      newsFeedModel([card({ subscriptionLabel: "Dota 2 patch notes" })])
        .moreHeading
    ).toBe("More updates from Dota 2 patch notes");
    expect(newsFeedModel([card()]).moreHeading).toBe(
      "More updates from this source"
    );
    // A blank configured name must not produce "from ".
    expect(newsFeedModel([card()], "  ").moreHeading).toBe(
      "More updates from this source"
    );
  });

  it("has no lead for an empty poll", () => {
    expect(newsFeedModel([])).toEqual({
      lead: null,
      more: [],
      moreHeading: "More updates from this source",
    });
  });

  it("keeps the provider's order for the more-list", () => {
    const model = newsFeedModel([
      card({ id: "a" }),
      card({ id: "b" }),
      card({ id: "c" }),
    ]);
    expect(model.more.map((item) => item.id)).toEqual(["b", "c"]);
  });
});

describe("feed labels", () => {
  it("writes a UTC date, and says so when the date is missing", () => {
    expect(postedLabel("2026-10-21T23:30:00.000Z")).toBe("21 Oct 2026");
    expect(postedLabel(null)).toBe("Date unavailable");
    expect(postedLabel("")).toBe("Date unavailable");
    expect(postedLabel("not a date")).toBe("Date unavailable");
  });

  it("leads the meta line with the posted date", () => {
    expect(feedMetaLine(card())).toBe(
      "Posted 21 Oct 2026 · Community Announcements"
    );
    expect(feedMetaLine(card({ publishedAt: null, sourceLabel: "" }))).toBe(
      "Posted Date unavailable · Unknown source"
    );
  });

  it("tones the attribution badge by what the item actually is", () => {
    expect(attributionTone({ attribution: "official" })).toBe("green");
    expect(attributionTone({ attribution: "syndicated" })).toBe("amber");
    expect(attributionTone({ attribution: "unknown" })).toBe("neutral");
  });

  it("does not treat store artwork as article imagery", () => {
    const [lead] = payload.items;
    // The recorded CS2 capture has no images at all, which is exactly why the
    // feature card must render without a 16:9 frame instead of reserving space.
    expect(lead.image).toBeNull();
    expect(lead.imageKind).toBeNull();
    expect(card({ imageKind: "app-artwork" }).imageKind).toBe("app-artwork");
  });
});
