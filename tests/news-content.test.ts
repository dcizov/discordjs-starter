import { describe, expect, it } from "vitest";
import {
  excerpt,
  imageFromMarkup,
  normalizeFeedText,
  plainText,
  safeImageUrl,
  steamAttribution,
  tidyText,
} from "@orbit/core/feed-content";
import { mapSteamNews, parseFeed, safeLink } from "@orbit/core/feeds";
import { feedEmbed, newsCard } from "@orbit/core/news-presentation";
import {
  atomFeed,
  malformedFeed,
  rssWithHtml,
  rssWithUnsafeImage,
  steamAnnouncement,
  steamExternalItem,
  steamUnknownAttribution,
} from "./fixtures/news";

describe("feed content normalization", () => {
  it("keeps Steam paragraph, heading and list boundaries instead of joining words", () => {
    const text = normalizeFeedText(steamAnnouncement.contents, "bbcode");
    expect(text).not.toMatch(/\[/);
    expect(text).not.toContain("flickerFixed");
    expect(text).toContain(
      "Added a progress bar for demo and replay downloads"
    );
    expect(text).toContain("• Camera controls now use click-and-drag");
    // Every bullet starts on its own line.
    const bullets = text.split("\n").filter((line) => line.startsWith("• "));
    expect(bullets).toHaveLength(3);
    expect(text).toContain("cleaned up a crash & freeze.");
    expect(text.split("\n").length).toBeGreaterThan(4);
  });

  it("separates HTML blocks, decodes entities and drops scripts", () => {
    const html =
      "<p>First paragraph</p><p>Second &amp; last</p><ul><li>One</li><li>Two</li></ul>" +
      "<script>alert(1)</script><style>p{color:red}</style><p>After.style{}</p>";
    const text = normalizeFeedText(html, "html");
    expect(text).toContain("First paragraph\n\nSecond & last");
    expect(text).toContain("• One");
    expect(text).toContain("• Two");
    expect(text).not.toContain("alert(1)");
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("<");
  });

  it("does not invent spacing inside inline markup and tolerates malformed input", () => {
    expect(normalizeFeedText("<p>Hello <b>world</b>.</p>", "html")).toBe(
      "Hello world."
    );
    expect(normalizeFeedText("Damage <5 and >3", "plain")).toContain("Damage");
    expect(tidyText("a\r\n\r\n\r\n\r\nb   c")).toBe("a\n\nb c");
    // Unclosed BBCode lists still produce readable lines.
    const malformed = normalizeFeedText(
      malformedFeed.split("<description>")[1].split("</description>")[0],
      "bbcode"
    );
    expect(malformed).toContain("item one");
    expect(malformed).toContain("item two");
    expect(malformed).not.toContain("[");
  });

  it("neutralizes mentions and control characters without slicing words", () => {
    const text = plainText("@everyone <@123456789> \u0007hello");
    expect(text).not.toContain("@everyone");
    expect(text).toContain("[mention]");
    expect(text).toContain("hello");
  });

  it("truncates at readable boundaries and never ends mid-word", () => {
    const sentence = "The quick brown fox jumps over the lazy dog. ";
    const short = excerpt(sentence.repeat(30), 96);
    expect(short.length).toBeLessThanOrEqual(97);
    expect(short).not.toMatch(/[a-z]…$/);
    const midSentence = excerpt("word ".repeat(40), 60);
    expect(midSentence.endsWith("…")).toBe(true);
    expect(midSentence).not.toMatch(/\sw…$/);
    expect(excerpt("tiny", 96)).toBe("tiny");
    expect(excerpt("", 96)).toBe("");
  });
});

describe("provider-supplied images", () => {
  it("only accepts renderable https image URLs", () => {
    expect(safeImageUrl("https://cdn.example.com/a.jpg")).toBe(
      "https://cdn.example.com/a.jpg"
    );
    for (const value of [
      "http://cdn.example.com/a.jpg",
      "https://user:pass@cdn.example.com/a.jpg",
      "https://localhost/a.jpg",
      "https://127.0.0.1/a.jpg",
      "https://internal.local/a.jpg",
      "https://cdn.example.com/a.exe",
      "https://cdn.example.com/a.jpg:8080",
      "javascript:alert(1)",
      "",
    ])
      expect(safeImageUrl(value)).toBe("");
  });

  it("extracts a provider-supplied image from Steam markup and HTML", () => {
    expect(imageFromMarkup(steamAnnouncement.contents)).toBe(
      "https://clan.cloudflare.steamstatic.com/images/1234/abcdef012345.jpg"
    );
    expect(
      imageFromMarkup('<p><img src="https://cdn.example.com/live/art.png"></p>')
    ).toBe("https://cdn.example.com/live/art.png");
    expect(imageFromMarkup("<p>no image here</p>")).toBe("");
  });
});

describe("Steam attribution and filtering", () => {
  it("classifies by the producing feed, never by is_external_url", () => {
    expect(steamAttribution(steamAnnouncement)).toBe("official");
    expect(steamAttribution(steamExternalItem)).toBe("syndicated");
    expect(steamAttribution(steamUnknownAttribution)).toBe("unknown");
    // Live Steam data sets is_external_url:true on Valve's own posts (the URL
    // is always a Steam redirect), so it must not demote an app announcement.
    expect(
      steamAttribution({
        is_external_url: true,
        feed_type: 1,
        feedname: "steam_community_announcements",
        url: "https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/1",
      })
    ).toBe("official");
    // ...and a publisher feed is syndicated even if the flag were false.
    expect(
      steamAttribution({
        is_external_url: false,
        feed_type: 0,
        feedlabel: "PC Gamer",
        feedname: "PC Gamer",
        url: "https://steamstore-a.akamaihd.net/news/externalpost/PC Gamer/1",
      })
    ).toBe("syndicated");
  });

  it("normalizes a Steam payload and explains official-only filtering", () => {
    const all = mapSteamNews(
      [steamAnnouncement, steamExternalItem, steamUnknownAttribution],
      { tags: ["CS2"] }
    );
    expect(all.items).toHaveLength(3);
    expect(all.items[0].sourceLabel).toBe("Community Announcements");
    expect(all.items[0].publisher).toBe("");
    expect(all.items[1].publisher).toBe("Esports Weekly");
    expect(all.items[0].publishedAt).toBe(
      new Date(steamAnnouncement.date * 1000).toISOString()
    );
    expect(all.items[0].tags).toEqual(["Steam", "CS2"]);
    expect(all.items[0].image).toContain("clan.cloudflare.steamstatic.com");
    expect(all.notices.some((n) => n.includes("first-party"))).toBe(false);

    const official = mapSteamNews(
      [steamAnnouncement, steamExternalItem, steamUnknownAttribution],
      { officialOnly: true }
    );
    expect(official.items.map((item) => item.id)).toEqual([
      steamAnnouncement.gid,
    ]);
    expect(official.notices.join(" ")).toContain("2 of 3");
  });

  it("reports an empty or non-array payload without throwing", () => {
    expect(mapSteamNews(undefined)).toEqual({ items: [], notices: [] });
    expect(mapSteamNews({ nope: true })).toEqual({ items: [], notices: [] });
  });
});

describe("RSS and Atom parsing", () => {
  it("normalizes HTML descriptions, keeps links, dates and images", () => {
    const items = parseFeed(rssWithHtml);
    expect(items).toHaveLength(3);
    const [first, bare, anonymous] = items;
    expect(first.id).toBe("post-1");
    expect(first.title).toBe("Patch & notes");
    expect(first.url).toBe("https://news.example.com/patch-notes");
    expect(first.summary).toContain("We fixed four bugs & one crash.");
    expect(first.summary).toContain(
      "• Crash on launch\n• Missing audio channel"
    );
    expect(first.summary).toContain(
      "Thanks for the reports.\nSee you next week."
    );
    expect(first.image).toBe("https://cdn.example.com/lead/patch.jpg");
    expect(first.tags).toEqual(["Patches"]);
    expect(first.publishedAt).toBe("2026-10-22T09:00:00.000Z");

    expect(bare.summary).toBe("");
    expect(bare.publishedAt).toBe("");
    expect(anonymous.id).toBe("https://news.example.com/anonymous");
  });

  it("parses Atom entries and strips markup from typed titles", () => {
    const [entry] = parseFeed(atomFeed);
    expect(entry.id).toBe("urn:uuid:1");
    expect(entry.title).toBe("Typed title");
    expect(entry.summary).toBe("One quiet paragraph.\n\nAnd a second line.");
    expect(entry.publishedAt).toBe("2026-10-20T10:00:00.000Z");
  });

  it("refuses unsafe image carriers instead of rendering them", () => {
    const [item] = parseFeed(rssWithUnsafeImage);
    expect(item.image).toBe("");
    expect(item.summary).toContain("Body text.");
  });
});

describe("shared preview and delivery presentation", () => {
  const item = {
    id: steamAnnouncement.gid,
    title: steamAnnouncement.title,
    url: steamAnnouncement.url,
    summary: normalizeFeedText(steamAnnouncement.contents, "bbcode"),
    publishedAt: new Date(steamAnnouncement.date * 1000).toISOString(),
    tags: ["Steam"],
    image: imageFromMarkup(steamAnnouncement.contents),
    attribution: "official" as const,
    sourceLabel: steamAnnouncement.feedlabel,
  };

  it("produces the same excerpt for the card and the Discord embed", () => {
    const card = newsCard(item, { sourceName: "CS2 updates" });
    const embed = feedEmbed(item, { sourceName: "CS2 updates" });
    expect(card.excerpt).toBe(embed.description);
    expect(card.url).toBe(steamAnnouncement.url);
    expect(embed.url).toBe(card.url);
    expect(embed.image).toEqual({ url: card.image });
    expect(embed.timestamp).toBe(item.publishedAt);
    // The footer names the producing feed, not the administrator's label, so a
    // syndicated item is never attributed to the subscription name.
    expect(embed.footer.text).toContain("Community Announcements");
    expect(embed.footer.text).toContain("App announcement");
    expect(card.subscriptionLabel).toBe("CS2 updates");
    expect(card.sourceLabel).toBe("Community Announcements");
    expect(card.linkLabel).toBe("Read the announcement");
  });

  it("omits missing metadata instead of inventing it", () => {
    const card = newsCard({
      id: "x",
      title: "",
      url: "javascript:alert(1)",
      summary: "",
      publishedAt: "not-a-date",
      image: "http://localhost/a.jpg",
    });
    expect(card.title).toBe("Untitled update");
    expect(card.url).toBe("");
    expect(card.excerpt).toBe("");
    expect(card.image).toBeNull();
    expect(card.publishedAt).toBeNull();
    expect(card.notices).toEqual(
      expect.arrayContaining([
        "No description supplied by the source.",
        "No usable article link supplied by the source.",
        "The supplied publication time could not be parsed.",
      ])
    );
    // A missing provider image is shown by the absence of an image, not as
    // diagnostic text inside every article card.
    expect(card.notices.join(" ")).not.toContain("image");
    const embed = feedEmbed({
      id: "x",
      title: "",
      url: "",
      summary: "",
      publishedAt: "",
    });
    expect(embed.url).toBeUndefined();
    expect(embed.description).toBeUndefined();
    expect(embed.timestamp).toBeUndefined();
    expect(embed.image).toBeUndefined();
  });

  it("respects Discord embed limits and the summary preference", () => {
    const long = {
      id: "long",
      title: "T".repeat(400),
      url: "https://example.com/long",
      summary: "Sentence with a normal shape. ".repeat(400),
      publishedAt: "2026-10-20T10:00:00.000Z",
      tags: [],
      image: null,
      attribution: "unknown" as const,
      sourceLabel: "S".repeat(400),
    };
    const embed = feedEmbed(long, { sourceName: "S".repeat(400) });
    expect(embed.title.length).toBeLessThanOrEqual(256);
    expect(embed.description!.length).toBeLessThanOrEqual(4096);
    expect(embed.footer.text.length).toBeLessThanOrEqual(2048);
    expect(embed.description).not.toMatch(/\s$/);
    expect(
      feedEmbed(long, { includeSummary: false }).description
    ).toBeUndefined();
  });

  it("keeps fetched text inert in links and mentions", () => {
    const card = newsCard({
      id: "m",
      title: "Heads up @everyone",
      url: "https://example.com/post",
      summary: "<@1234> ping @here",
      publishedAt: "2026-10-20T10:00:00.000Z",
    });
    expect(card.title).not.toContain("@everyone");
    expect(card.excerpt).not.toContain("@here");
    expect(card.excerpt).toContain("[mention]");
    expect(safeLink("https://user:pass@example.com/x")).toBe("");
  });
});
