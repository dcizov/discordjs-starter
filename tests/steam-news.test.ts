import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeFeedText,
  steamIdentity,
  steamMarkupToText,
} from "@orbit/core/feed-content";
import { mapSteamNews, steamNewsUrl } from "@orbit/core/feeds";
import {
  feedEmbed,
  NEWS_LIMITS,
  newsCard,
} from "@orbit/core/news-presentation";

/**
 * Regression suite for the reported Steam defect, driven by recorded provider
 * responses rather than hand-written approximations.
 *
 * Provenance (see tests/fixtures/steam/README.md):
 * - `730-2026-10-25.json`: `?appid=730&count=10&maxlength=0&feeds=steam_community_announcements`
 * - `570-2026-10-25.json`: `?appid=570&count=6&maxlength=700` (upstream-truncated)
 * Both captured 2026-10-25. No key was sent; no redactions were needed.
 */
type SteamItem = {
  gid: string;
  title: string;
  url: string;
  is_external_url: boolean;
  author: string;
  contents: string;
  feedlabel: string;
  date: number;
  feedname: string;
  feed_type: number;
  appid: number;
};

function load(name: string): SteamItem[] {
  const raw = JSON.parse(
    readFileSync(resolve("tests/fixtures/steam", name), "utf8")
  );
  return raw.appnews.newsitems as SteamItem[];
}

const cs2 = load("730-2026-10-25.json");
const dota = load("570-2026-10-25.json");

const byGid = (items: SteamItem[], gid: string) => {
  const item = items.find((entry) => entry.gid === gid);
  if (!item) throw new Error(`capture ${gid} missing`);
  return item;
};

/** The article from the reported bug report. */
const reported = byGid(cs2, "1846651706675829");
/** Closing markers, nested lists, no `[/*]` immediately before `[/list]`. */
const nested = byGid(cs2, "1847286114034398");
const syndicated = byGid(cs2, "1846651706695791");
const plainTextAnnouncement = byGid(dota, "1846018067924633");

const card = (item: SteamItem) => {
  const [mapped] = mapSteamNews([item]).items;
  return newsCard(mapped, { sourceName: "CS2 updates" });
};

describe("recorded Steam capture: the reported article", () => {
  const text = steamMarkupToText(reported.contents);

  it("drops every list marker, including the closing [/*]", () => {
    expect(text).not.toContain("[/*]");
    expect(text).not.toContain("[*]");
    expect(text).not.toContain("[/list]");
    expect(text).not.toContain("[p]");
  });

  it("keeps the escaped section headings as literal text", () => {
    expect(reported.contents).toContain("\\[ UI ]");
    expect(text.split("\n")[0]).toBe("[ UI ]");
    expect(text.split("\n")).toContain("[ MISC ]");
    // No stray escape characters survive into the rendered text.
    expect(text).not.toContain("\\");
  });

  it("renders one compact line per bullet with no blank lines between them", () => {
    const lines = text.split("\n");
    const bullets = lines.filter((line) => line.startsWith("• "));
    expect(bullets).toHaveLength(9);
    expect(bullets[0]).toBe("• Added a progress bar for demo/replay downloads");
    // No empty line anywhere inside a list group.
    expect(text).not.toMatch(/•[^\n]*\n\n•/);
    // A blank line separates the last bullet of a group from the next heading,
    // and there is no blank line *between* bullets.
    expect(text).toContain("demo file\n\n[ MISC ]");
  });

  it("unescapes the quoted launch flag instead of showing backslashes", () => {
    expect(text).toContain('flag "-allow_round_backup_files"');
  });

  it("produces a bounded, readable card excerpt", () => {
    const rendered = card(reported);
    expect(rendered.title).toBe("Counter-Strike 2 Update");
    expect(rendered.excerpt).toBe(
      [
        "[ UI ]",
        "",
        "Demo/Replay viewer improvements:",
        "• Added a progress bar for demo/replay downloads",
        "• Camera controls now use click-and-drag scheme",
        "• Free and chase camera are usable during a paused demo",
        "• Fixed some minor issues when seeking to a different position in the demo file",
      ].join("\n")
    );
    expect(rendered.excerpt).not.toContain("[/*]");
    expect(rendered.excerpt).not.toContain("[ MISC ]");
    expect(rendered.excerpt.length).toBeLessThanOrEqual(NEWS_LIMITS.excerpt);
    // 6 lines of text, not a wall: the card stays a preview of the article.
    expect(rendered.excerpt.split("\n").length).toBeLessThanOrEqual(7);
    expect(rendered.notices).toEqual([]);
  });
});

describe("recorded Steam capture: nested lists", () => {
  const text = steamMarkupToText(nested.contents);

  it("keeps nesting visible with distinct compact markers", () => {
    expect(text).not.toContain("[/*]");
    expect(text.split("\n").filter((line) => line === "")).toHaveLength(0);
    expect(text).toContain("• Added Instance.Precache");
    expect(text).toContain("◦ Returns a CSPrecache object");
    // The outer item that owns a nested list is not swallowed by it.
    expect(text).toContain("• Added CSHostage");
    expect(text).toContain("• Added new top level export Console");
  });

  it("never concatenates neighbouring items", () => {
    expect(text).not.toContain("PrecacheReturns");
    expect(text).not.toMatch(/[a-z][A-Z]\.[A-Z]/);
  });

  it("bounds the excerpt to five bullets even though the item has forty", () => {
    const rendered = card(nested);
    const bullets = rendered.excerpt
      .split("\n")
      .filter((line) => /^[•◦▪] /.test(line));
    expect(bullets).toHaveLength(NEWS_LIMITS.excerptBullets);
    expect(rendered.excerpt.length).toBeLessThan(360);
  });
});

describe("recorded Steam capture: attribution", () => {
  it("never calls a link-out a non-first-party post", () => {
    const rendered = card(reported);
    expect(rendered.attribution).toBe("official");
    expect(rendered.attributionLabel).toBe("App announcement");
    expect(rendered.attributionLabel.toLowerCase()).not.toContain(
      "first-party"
    );
    expect(rendered.sourceLabel).toBe("Community Announcements");
  });

  it("names the real publisher for a syndicated item", () => {
    const rendered = card(syndicated);
    expect(rendered.attribution).toBe("syndicated");
    expect(rendered.publisher).toBe("Rock, Paper, Shotgun");
    expect(rendered.sourceLabel).toBe("Rock, Paper, Shotgun");
    expect(rendered.attributionLabel).toBe(
      "Republished from Rock, Paper, Shotgun"
    );
    expect(rendered.linkLabel).toBe("Read the article at Rock, Paper, Shotgun");
    // The administrator's label must not be presented as the author.
    expect(rendered.subscriptionLabel).toBe("CS2 updates");
    expect(rendered.attributionLabel).not.toContain("CS2 updates");
  });

  it("classifies the app feed and the publisher feed differently from identical flags", () => {
    // Both captures carry is_external_url:true and a Steam redirect URL.
    expect(reported.is_external_url).toBe(true);
    expect(syndicated.is_external_url).toBe(true);
    expect(steamIdentity(reported).attribution).toBe("official");
    expect(steamIdentity(syndicated).attribution).toBe("syndicated");
  });

  it("keeps attribution stable when the flag alone would be misleading", () => {
    expect(
      steamIdentity({ ...reported, is_external_url: false }).attribution
    ).toBe("official");
    expect(
      steamIdentity({ ...syndicated, is_external_url: false }).attribution
    ).toBe("syndicated");
    expect(
      steamIdentity({ feed_type: 7, feedname: "", feedlabel: "" }).attribution
    ).toBe("unknown");
  });
});

describe("official-only filtering", () => {
  it("asks Steam for the app announcement feed instead of filtering ten mixed items", () => {
    const url = new URL(steamNewsUrl(730, true));
    expect(url.pathname).toBe("/ISteamNews/GetNewsForApp/v2/");
    expect(url.searchParams.get("appid")).toBe("730");
    expect(url.searchParams.get("feeds")).toBe("steam_community_announcements");
    expect(url.searchParams.get("maxlength")).toBe("0");
    expect(url.searchParams.get("count")).toBe("10");
    // No credential is invented for an endpoint that answered without one.
    expect(url.searchParams.has("key")).toBe(false);
    expect(new URL(steamNewsUrl(730)).searchParams.has("feeds")).toBe(false);
  });

  it("still filters locally and says so", () => {
    const all = mapSteamNews(cs2);
    expect(all.items).toHaveLength(4);
    const official = mapSteamNews(cs2, { officialOnly: true });
    expect(official.items.map((item) => item.id)).toEqual([
      "1847286114034398",
      "1846651706675829",
      "1846018067931597",
    ]);
    expect(official.notices.join(" ")).toContain("1 of 4");
  });

  it("reports a payload with no official item instead of promoting one", () => {
    const onlyPublisher = mapSteamNews([syndicated], { officialOnly: true });
    expect(onlyPublisher.items).toEqual([]);
    expect(onlyPublisher.notices.join(" ")).toContain(
      "1 of 1 item was not in Steam's app announcement feed"
    );
  });
});

describe("upstream truncation", () => {
  it("detects Steam's own maxlength ellipsis", () => {
    expect(plainTextAnnouncement.contents.trimEnd().endsWith("…")).toBe(true);
    const result = mapSteamNews([plainTextAnnouncement]);
    expect(result.notices.join(" ")).toContain("truncated upstream");
    // Full-content requests are what avoid this in production.
    expect(steamNewsUrl(570)).toContain("maxlength=0");
  });

  it("does not invent a truncation notice for complete content", () => {
    expect(mapSteamNews([reported]).notices.join(" ")).not.toContain(
      "truncated upstream"
    );
  });
});

describe("plain-text provider items", () => {
  it("keeps paragraphs and drops the publisher's trailing boilerplate fence", () => {
    const text = steamMarkupToText(syndicated.contents);
    expect(text).not.toContain("[");
    expect(text).toContain("European ratings board PEGI");
    // No double spaces inside a line (a blank line between paragraphs is fine).
    expect(text).not.toMatch(/[^\S\n]{2,}/);
  });

  it("handles non-Latin content without losing characters", () => {
    const [mapped] = mapSteamNews([dota[0]]).items;
    expect(mapped.title).toContain("сокровищницу Trove of Terror");
    expect(mapped.summary).toContain("424 рубля");
    expect(mapped.attribution).toBe("syndicated");
    expect(mapped.publisher).toBe("PlayGround.ru - официальная группа");
  });
});

describe("preview and delivery parity on real content", () => {
  it("gives the dashboard card and the Discord embed the same excerpt", () => {
    const [mapped] = mapSteamNews([reported]).items;
    const preview = newsCard(mapped, { sourceName: "CS2 updates" });
    const embed = feedEmbed(mapped, { sourceName: "CS2 updates" });
    expect(embed.description).toBe(preview.excerpt);
    expect(embed.url).toBe(preview.url);
    expect(embed.title).toBe("Counter-Strike 2 Update");
    expect(embed.timestamp).toBe("2026-10-14T23:02:48.000Z");
    expect(embed.footer.text).toBe(
      "Community Announcements · App announcement · via Orbit"
    );
    // Discord's own limits still hold for a real changelog.
    expect(embed.description!.length).toBeLessThanOrEqual(4096);
    expect(embed.description).not.toContain("[/*]");
  });

  it("labels a syndicated embed with the publisher, not the subscription", () => {
    const [mapped] = mapSteamNews([syndicated]).items;
    const embed = feedEmbed(mapped, { sourceName: "CS2 updates" });
    expect(embed.footer.text).toBe(
      "Rock, Paper, Shotgun · Republished from Rock, Paper, Shotgun · via Orbit"
    );
    expect(embed.footer.text).not.toContain("CS2 updates");
  });
});

describe("recorded browser fixture", () => {
  it("stays byte-identical to what the route produces for the capture", () => {
    // `tests/fixtures/steam/preview-payload.json` is replayed by
    // tests/e2e/news-preview.spec.ts as the test-flight response, so the
    // browser renders real provider content without a live Steam call. If this
    // fails, regenerate it with `npx tsx scripts/build-steam-preview.ts`.
    const committed = JSON.parse(
      readFileSync(resolve("tests/fixtures/steam/preview-payload.json"), "utf8")
    );
    const polled = mapSteamNews(cs2, { tags: [] });
    const expected = {
      ok: true,
      count: polled.items.length,
      shown: Math.min(polled.items.length, 3),
      items: polled.items
        .slice(0, 3)
        .map((item) => newsCard(item, { sourceName: "CS2 updates" })),
      notices: polled.notices,
      officialOnly: false,
      demo: false,
    };
    expect(committed).toEqual(JSON.parse(JSON.stringify(expected)));
  });
});

describe("malformed provider input", () => {
  it("does not leak markers when the payload is cut mid-list", () => {
    const truncated = reported.contents.slice(0, 260);
    const text = steamMarkupToText(truncated);
    expect(text).not.toContain("[/*]");
    expect(text).not.toContain("[p]");
    expect(text).toContain("[ UI ]");
  });

  it("treats unknown bracketed text as author-written text", () => {
    expect(steamMarkupToText("[p][Season 4][/p]")).toBe("[Season 4]");
    expect(steamMarkupToText("[p]Damage <5[/p]")).toBe("Damage <5");
    expect(normalizeFeedText("", "bbcode")).toBe("");
  });
});
