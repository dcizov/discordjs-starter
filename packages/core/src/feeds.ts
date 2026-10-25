import { officialJson, upstreamError } from "./integration-http";
export { officialJson } from "./integration-http";
export { searchGames, pollDeals } from "./deals";
import { XMLParser } from "fast-xml-parser";
import { lookup } from "node:dns/promises";
import { Agent, request } from "undici";
import { assertFeedUrl, isPublicAddress, safeText } from "./safety";
import type { FeedItem, Resource } from "./types";
const MAX_BYTES = 1024 * 1024;

export async function fetchFeedText(
  input: string,
  redirects = 0
): Promise<string> {
  const u = assertFeedUrl(input);
  if (redirects > 3) throw new Error("Feed redirected too many times");
  const hostname = u.hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !isPublicAddress(a.address)))
    throw new Error(
      "The feed resolves to a private, reserved, or internal address"
    );
  const pinned = addresses[0];
  // Pin the validated DNS address for the actual socket; checking DNS alone allows rebinding.
  const agent = new Agent({
    connect: {
      lookup: ((_host: any, _opts: any, cb: any) => {
        if (_opts?.all) cb(null, [pinned]);
        else cb(null, pinned.address, pinned.family);
      }) as any,
    },
  });
  try {
    const res = await request(u, {
      dispatcher: agent,
      headersTimeout: 10000,
      bodyTimeout: 10000,
      signal: AbortSignal.timeout(15000),
      headers: {
        "user-agent": "OrbitFeedReader/1.0 (+RSS/Atom; community bot)",
        accept:
          "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9",
      },
    });
    if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
      res.body.destroy();
      if (!res.headers.location)
        throw new Error("Feed redirect has no destination");
      return fetchFeedText(
        new URL(String(res.headers.location), u).toString(),
        redirects + 1
      );
    }
    if (res.statusCode !== 200) {
      res.body.destroy();
      throw upstreamError(
        res.statusCode,
        String(res.headers["retry-after"] ?? "")
      );
    }
    const type = String(res.headers["content-type"] ?? "");
    if (!/(xml|rss|atom|text\/plain)/i.test(type)) {
      res.body.destroy();
      throw new Error("The address does not return an RSS/Atom document");
    }
    if (Number(res.headers["content-length"] ?? 0) > MAX_BYTES) {
      res.body.destroy();
      throw new Error("Feed is larger than 1 MB");
    }
    let length = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of res.body) {
      const b = Buffer.from(chunk);
      length += b.length;
      if (length > MAX_BYTES) {
        res.body.destroy();
        throw new Error("Feed is larger than 1 MB");
      }
      chunks.push(b);
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    await agent.close();
  }
}
const array = (v: any): any[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const string = (v: any): string =>
  typeof v === "string"
    ? v
    : typeof v === "number"
      ? String(v)
      : v?.["#text"]
        ? String(v["#text"])
        : "";
export function safeLink(value: string) {
  try {
    const u = new URL(value);
    if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
      return "";
    return u.toString().slice(0, 2000);
  } catch {
    return "";
  }
}
export function parseFeed(xml: string): FeedItem[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("XML entities and DTDs are not supported");
  const doc = new XMLParser({
    ignoreAttributes: false,
    processEntities: false,
    trimValues: true,
    parseTagValue: false,
  }).parse(xml);
  const entries = array(
    doc?.rss?.channel?.item ?? doc?.feed?.entry ?? doc?.["rdf:RDF"]?.item
  );
  if (!doc?.rss && !doc?.feed && !doc?.["rdf:RDF"])
    throw new Error("No RSS or Atom feed was found");
  return entries
    .slice(0, 50)
    .map((e: any) => {
      const link =
        typeof e.link === "string"
          ? e.link
          : (array(e.link).find(
              (l: any) => !l["@_rel"] || l["@_rel"] === "alternate"
            )?.["@_href"] ?? "");
      const date = new Date(string(e.pubDate ?? e.published ?? e.updated));
      const title = safeText(string(e.title), 256);
      const url = safeLink(link);
      const id =
        string(e.guid ?? e.id) ||
        url ||
        `${title}:${string(e.pubDate ?? e.published)}`;
      return {
        id,
        title,
        url,
        summary: safeText(
          string(
            e.description ?? e.summary ?? e.content ?? e["content:encoded"]
          ),
          1000
        ),
        publishedAt: Number.isNaN(date.getTime())
          ? new Date().toISOString()
          : date.toISOString(),
        tags: array(e.category)
          .map((c: any) => safeText(string(c) || c?.["@_term"] || "", 30))
          .filter(Boolean),
      };
    })
    .filter((i) => i.id && i.title);
}

export async function pollSource(source: Resource): Promise<FeedItem[]> {
  const d = source.data;
  if (d.adapter === "webhook") return [];
  if (d.adapter === "steam") {
    if (!d.appId) throw new Error("A Steam application ID is required");
    const json = await officialJson(
      `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${d.appId}&count=10&maxlength=1000`
    );
    return (json.appnews?.newsitems ?? []).map((n: any) => ({
      id: String(n.gid),
      title: safeText(n.title, 256),
      url: safeLink(n.url),
      summary: safeText(n.contents, 1000),
      publishedAt: new Date(n.date * 1000).toISOString(),
      tags: ["Steam", ...(d.tags ?? [])],
    }));
  }
  if (!d.url)
    throw new Error(
      "Setup required: add a verified RSS/Atom feed URL, or choose an incoming webhook. Orbit does not scrape sites."
    );
  return parseFeed(await fetchFeedText(d.url));
}
export { matchesFilters } from "./feed-routing";
