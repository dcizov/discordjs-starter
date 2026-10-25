import { officialJson, upstreamError } from "./integration-http";
export { officialJson } from "./integration-http";
export { searchGames, pollDeals } from "./deals";
import { XMLParser } from "fast-xml-parser";
import { lookup } from "node:dns/promises";
import { Agent, request } from "undici";
import { assertFeedUrl, isPublicAddress, safeLink } from "./safety";
import {
  excerpt,
  imageFromMarkup,
  normalizeFeedText,
  plainText,
  safeImageUrl,
  steamAttribution,
} from "./feed-content";
import type { NewsAttribution } from "./news-presentation";
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
export { safeLink } from "./safety";
export type FeedPollResult = { items: FeedItem[]; notices: string[] };

/** Provider-supplied lead image from the common RSS/Atom image carriers. */
function feedEntryImage(entry: any) {
  const candidates: string[] = [];
  for (const media of [
    ...array(entry.enclosure),
    ...array(entry["media:content"]),
    ...array(entry["media:thumbnail"]),
    ...array(entry["itunes:image"]),
  ]) {
    const url = String(media?.["@_url"] ?? media?.["@_href"] ?? "");
    const type = String(media?.["@_type"] ?? "");
    if (url && (!type || type.startsWith("image/"))) candidates.push(url);
  }
  const markup = string(
    entry["content:encoded"] ?? entry.description ?? entry.summary
  );
  const inline = imageFromMarkup(markup);
  if (inline) candidates.push(inline);
  for (const candidate of candidates) {
    const safe = safeImageUrl(candidate);
    if (safe) return safe;
  }
  return "";
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
      const rawDate = string(e.pubDate ?? e.published ?? e.updated);
      const date = new Date(rawDate);
      const title = plainText(string(e.title), 256);
      const url = safeLink(link);
      const id = string(e.guid ?? e.id) || url || `${title}:${rawDate}`;
      // Publisher feeds are HTML or already plain text; both are handled by the
      // same block-aware normalizer before anything is stored or rendered.
      const content = string(
        e["content:encoded"] ?? e.description ?? e.summary ?? e.content
      );
      const text = excerpt(
        normalizeFeedText(
          content,
          /<[a-z][\s\S]*>/i.test(content) ? "html" : "plain"
        ),
        1200
      );
      return {
        id,
        title,
        url,
        summary: text,
        publishedAt: Number.isNaN(date.getTime()) ? "" : date.toISOString(),
        tags: array(e.category)
          .map((c: any) => plainText(string(c) || c?.["@_term"] || "", 30))
          .filter(Boolean),
        image: feedEntryImage(e),
        attribution: "unknown" as NewsAttribution,
        sourceLabel: "",
      };
    })
    .filter((i) => i.id && i.title);
}

function steamItem(item: any, tags: string[]) {
  const contents = String(item?.contents ?? "");
  return {
    id: String(item?.gid ?? ""),
    title: plainText(String(item?.title ?? ""), 256),
    url: safeLink(String(item?.url ?? "")),
    summary: excerpt(normalizeFeedText(contents, "bbcode"), 1200),
    publishedAt:
      Number(item?.date) > 0
        ? new Date(Number(item.date) * 1000).toISOString()
        : "",
    tags: ["Steam", ...tags],
    image: imageFromMarkup(contents),
    attribution: steamAttribution(item ?? {}),
    sourceLabel: plainText(String(item?.feedlabel ?? "Steam"), 120),
  } satisfies FeedItem;
}

/**
 * Poll a source and report what the adapter could not represent. Notices are
 * shown in the dashboard preview so a partial result is never presented as a
 * complete one.
 */
/** Normalize an `ISteamNews` payload. Pure, so filtering is testable offline. */
export function mapSteamNews(
  newsitems: unknown,
  options: { tags?: string[]; officialOnly?: boolean } = {}
): FeedPollResult {
  const raw = Array.isArray(newsitems) ? newsitems : [];
  const mapped = raw
    .map((n: any) => steamItem(n, options.tags ?? []))
    .filter((i: FeedItem) => i.id && i.title);
  const items = options.officialOnly
    ? mapped.filter((i: FeedItem) => i.attribution === "official")
    : mapped;
  const notices: string[] = [];
  if (options.officialOnly) {
    const hidden = mapped.length - items.length;
    if (hidden > 0)
      notices.push(
        `${hidden} of ${mapped.length} recent items were hidden by the official-only filter. Steam metadata decides this; items Steam labels as app announcements can still be community crossposts.`
      );
  }
  if (
    items.length &&
    !items.some((i: FeedItem) => i.attribution === "official")
  )
    notices.push(
      "None of these items is labelled as a first-party announcement by Steam metadata."
    );
  if (items.length && !items.some((i: FeedItem) => i.image))
    notices.push("Steam's news API supplies no lead image for these items.");
  return { items, notices };
}

export async function pollSourceDetailed(
  source: Resource
): Promise<FeedPollResult> {
  const d = source.data;
  if (d.adapter === "webhook") return { items: [], notices: [] };
  if (d.adapter === "steam") {
    if (!d.appId) throw new Error("A Steam application ID is required");
    const json = await officialJson(
      `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${d.appId}&count=10&maxlength=0`
    );
    return mapSteamNews(json.appnews?.newsitems, {
      tags: d.tags ?? [],
      officialOnly: !!d.officialOnly,
    });
  }
  if (!d.url)
    throw new Error(
      "Setup required: add a verified RSS/Atom feed URL, or choose an incoming webhook. Orbit does not scrape sites."
    );
  const items = parseFeed(await fetchFeedText(d.url));
  const notices: string[] = [];
  if (!items.some((i) => i.image))
    notices.push(
      "No feed supplied an image carrier (enclosure, media:content or inline image). Orbit does not fetch Open Graph images."
    );
  if (!items.some((i) => i.summary))
    notices.push(
      "Some entries had no description; their cards show the title only."
    );
  return { items, notices };
}

export async function pollSource(source: Resource): Promise<FeedItem[]> {
  return (await pollSourceDetailed(source)).items;
}
export { matchesFilters } from "./feed-routing";
