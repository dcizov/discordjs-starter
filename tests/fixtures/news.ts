/**
 * Small hand-built payloads for generic behaviour (HTML, entities, images,
 * malformed input). The Steam entries below mirror the *real* field values
 * observed on 2026-10-25 so they exercise the true branch conditions, but the
 * recorded provider responses live in `tests/fixtures/steam/` and are what the
 * Steam regression suite uses. No provider is contacted by tests.
 */

/**
 * Steam announcement mixing BBCode, HTML entities and a clan image token.
 * `is_external_url` is `true` and the URL is the Steam redirector, exactly as
 * the live API returns them, so this fixture also proves the flag is ignored.
 */
export const steamAnnouncement = {
  gid: "5500000000000001",
  title: "Release Notes for 24 Oct 2026",
  url: "https://steamstore-a.akamaihd.net/news/externalpost/steam_community_announcements/5500000000000001",
  is_external_url: true,
  author: "Valve",
  contents:
    "[img]{STEAM_CLAN_IMAGE}/1234/abcdef012345.jpg[/img]\n" +
    "[p][b]Release notes[/b][/p]\n" +
    "[p][list]\n" +
    "[*] Added a progress bar for demo and replay downloads\n" +
    "[*] Camera controls now use click-and-drag\n" +
    "[*] Fixed a flicker when opening the buy menu[/list][/p]\n" +
    "[p]Removed console warnings and cleaned up a crash &amp; freeze.[/p]",
  feedlabel: "Community Announcements",
  date: 1792836000,
  feedname: "steam_community_announcements",
  feed_type: 1,
  appid: 730,
};

/**
 * Syndicated item. `feed_type: 0` and a publisher-named feed are the only
 * metadata Steam supplies to distinguish it; the URL is still a Steam redirect.
 */
export const steamExternalItem = {
  gid: "5500000000000002",
  title: "A community tournament recap",
  url: "https://steamstore-a.akamaihd.net/news/externalpost/Esports Weekly/5500000000000002",
  is_external_url: true,
  author: "Esports Weekly",
  contents: "[p]Our weekly roundup of community matches.[/p]",
  feedlabel: "Esports Weekly",
  date: 1792740000,
  feedname: "Esports Weekly",
  feed_type: 0,
  appid: 730,
};

/** Steam item whose attribution metadata does not identify the publisher. */
export const steamUnknownAttribution = {
  gid: "5500000000000003",
  title: "Something appeared",
  url: "https://steamstore-a.akamaihd.net/news/externalpost//5500000000000003",
  is_external_url: true,
  author: "",
  contents: "Plain text without any markup at all.",
  feedlabel: "",
  date: 1792650000,
  feedname: "",
  feed_type: 2,
  appid: 730,
};

export const rssWithHtml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>Studio notes</title>
    <item>
      <guid isPermaLink="false">post-1</guid>
      <title>Patch &amp; notes</title>
      <link>https://news.example.com/patch-notes</link>
      <pubDate>Wed, 22 Oct 2026 09:00:00 GMT</pubDate>
      <description><![CDATA[
        <p>We fixed <b>four</b> bugs &amp; one crash.</p>
        <ul><li>Crash on launch</li><li>Missing audio channel</li></ul>
        <script>alert("nope")</script>
        <p>Thanks for the reports.<br>See you next week.</p>
        <img src="https://cdn.example.com/inline/patch.jpg" alt="patch art">
      ]]></description>
      <category>Patches</category>
      <enclosure url="https://cdn.example.com/lead/patch.jpg" type="image/jpeg" length="0"/>
    </item>
    <item>
      <guid>post-2</guid>
      <title>Bare announcement</title>
      <link>https://news.example.com/bare</link>
    </item>
    <item>
      <title>No identifier at all</title>
      <link>https://news.example.com/anonymous</link>
      <description>Uses the link as a stable identity.</description>
    </item>
  </channel>
</rss>`;

export const atomFeed = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example</title>
  <entry>
    <id>urn:uuid:1</id>
    <title type="html">&lt;em&gt;Typed&lt;/em&gt; title</title>
    <link rel="alternate" href="https://example.org/posts/typed"/>
    <updated>2026-10-20T10:00:00Z</updated>
    <summary>One quiet paragraph.

And a second line.</summary>
  </entry>
</feed>`;

export const malformedFeed = `<rss version="2.0"><channel>
  <item><guid>x</guid><title>Unclosed markup</title><link>https://example.com/x</link>
  <description>[list][*]item one[*]item two</description></item>
</channel></rss>`;

/** RSS item whose only image carrier is not a renderable https image. */
export const rssWithUnsafeImage = `<rss version="2.0"><channel><item>
  <guid>unsafe-1</guid><title>Unsafe image</title>
  <link>https://example.com/unsafe</link>
  <description><![CDATA[<p>Body text.</p><img src="http://localhost:8080/internal/secret.jpg">]]></description>
  <media:content url="http://10.0.0.4/logo.png" type="image/png"/>
</item></channel></rss>`;
