import {
  assertFeedUrl,
  decrypt,
  encrypt,
  fingerprint,
  isPublicAddress,
  safeText,
  verifyWebhook,
} from "@orbit/core";
import { matchesFilters, parseFeed, safeLink } from "@orbit/core/feeds";
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
describe("feed ingestion safety", () => {
  it("accepts genuine RSS and Atom without executing external content", () => {
    const rss = parseFeed(
      '<rss version="2.0"><channel><item><guid>x</guid><title>Good news</title><link>https://example.com/story</link><description><![CDATA[<b>Hi</b><script>alert(1)</script>]]></description></item></channel></rss>'
    );
    expect(rss[0].id).toBe("x");
    expect(rss[0].summary).not.toContain("<");
    const atom = parseFeed(
      '<feed><entry><id>abc</id><title>A new day</title><link href="https://example.com/a"/><summary>Things are good.</summary></entry></feed>'
    );
    expect(atom[0].url).toBe("https://example.com/a");
  });
  it("rejects XML entities, DTDs, and HTML masquerading as a feed", () => {
    expect(() => parseFeed('<!DOCTYPE x [<!ENTITY a "x">]><rss/>')).toThrow();
    expect(() => parseFeed("<html><body>Not a feed</body></html>")).toThrow();
  });
  it("blocks local, metadata, private, mapped, reserved, and non-HTTPS destinations", () => {
    for (const url of [
      "http://example.com/feed",
      "https://localhost/feed",
      "https://127.0.0.1",
      "https://10.0.0.1",
      "https://169.254.169.254",
      "https://2130706433/",
      "https://[::1]/",
      "https://[::ffff:127.0.0.1]",
      "https://example.com:444/",
      "https://user:password@example.com/feed",
    ])
      expect(() => assertFeedUrl(url)).toThrow();
    for (const ip of [
      "192.168.1.1",
      "172.31.2.1",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "fc00::1",
      "fe80::1",
      "2001:db8::1",
      "2002:7f00:1::",
    ])
      expect(isPublicAddress(ip)).toBe(false);
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });
  it("allows valid public HTTPS URLs and strips dangerous links", () => {
    expect(assertFeedUrl("https://example.com/feed.xml").hostname).toBe(
      "example.com"
    );
    expect(safeLink("javascript:alert(1)")).toBe("");
    expect(safeLink("https://user:password@example.com")).toBe("");
  });
  it("sanitizes HTML and prevents mass or user mentions", () => {
    const text = safeText(
      "<script>bad()</script>Hello @everyone @here <@123456789012345678>"
    );
    expect(text).not.toContain("<script>");
    expect(text).not.toContain("@everyone");
    expect(text).not.toContain("@here");
    expect(text).not.toContain("<@");
  });
  it("matches configured keywords and tags without interpreting regular expressions", () => {
    const item = {
      id: "1",
      title: "Minecraft update",
      summary: "New blocks",
      url: "",
      publishedAt: "",
      tags: ["Minecraft"],
    };
    expect(matchesFilters(item, ["UPDATE"], ["minecraft"])).toBe(true);
    expect(matchesFilters(item, ["sale"])).toBe(false);
    expect(matchesFilters(item, [".*"])).toBe(false);
    expect(matchesFilters(item, [], ["Steam"])).toBe(false);
  });
  it("namespaces deduplication keys by server, source, and external event", () => {
    expect(fingerprint("g1", "s1", "e1")).toBe(fingerprint("g1", "s1", "e1"));
    expect(
      new Set([
        fingerprint("g1", "s1", "e1"),
        fingerprint("g2", "s1", "e1"),
        fingerprint("g1", "s2", "e1"),
      ]).size
    ).toBe(3);
  });
});
describe("signed webhooks and server-side credentials", () => {
  it("requires authentic body bytes and a recent timestamp", () => {
    const raw = '{"id":"a","title":"Update"}',
      secret = "a-very-long-secret",
      timestamp = String(Date.now());
    const signature = createHmac("sha256", secret)
      .update(`${timestamp}.${raw}`)
      .digest("hex");
    expect(verifyWebhook(raw, timestamp, signature, secret)).toBe(true);
    expect(verifyWebhook(raw + " ", timestamp, signature, secret)).toBe(false);
    expect(verifyWebhook(raw, timestamp, "aa", secret)).toBe(false);
    expect(
      verifyWebhook(raw, timestamp, signature, secret, Date.now() + 301000)
    ).toBe(false);
  });
  it("encrypts and authenticates OAuth tokens at rest", () => {
    const encrypted = encrypt("discord-access-token", "my-secret");
    expect(encrypted).not.toContain("discord");
    expect(decrypt(encrypted, "my-secret")).toBe("discord-access-token");
    expect(() => decrypt(encrypted, "other-key")).toThrow();
  });
});
