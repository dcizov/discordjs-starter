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
  steamIdentity,
} from "./feed-content";
import type { NewsAttribution } from "./news-presentation";
import type { FeedItem, Resource } from "./types";
import {
  steamArtwork,
  steamArtworkEnabled,
  type SteamArtworkCache,
} from "./steam-artwork";
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
  const identity = steamIdentity(item ?? {});
  // Article imagery only comes from the article body; Steam's news payload has
  // no image field. The store-artwork fallback is applied later and labelled.
  const articleImage = imageFromMarkup(contents);
  return {
    id: String(item?.gid ?? ""),
    title: plainText(String(item?.title ?? ""), 256),
    url: safeLink(String(item?.url ?? "")),
    summary: normalizeFeedText(contents, "bbcode"),
    publishedAt:
      Number(item?.date) > 0
        ? new Date(Number(item.date) * 1000).toISOString()
        : "",
    tags: ["Steam", ...tags],
    image: articleImage,
    ...(articleImage ? { imageKind: "article" as const } : {}),
    attribution: identity.attribution,
    sourceLabel: identity.feedLabel,
    publisher: identity.publisher,
  } satisfies FeedItem;
}

/**
 * Poll a source and report what the adapter could not represent. Notices are
 * shown in the dashboard preview so a partial result is never presented as a
 * complete one.
 */
/**
 * The official-only filter asks Steam for the app's announcement feed instead of
 * filtering a mixed page of ten items locally (which silently hides older
 * matching posts). `feeds` is not in Valve's published parameter list; it is
 * used only for this filter and the caller falls back to local filtering if the
 * response still contains other feeds.
 */
export const STEAM_ANNOUNCEMENT_FEED = "steam_community_announcements";

export function steamNewsUrl(appId: number, officialOnly = false) {
  const params = new URLSearchParams({
    appid: String(appId),
    count: "10",
    // Full content: upstream truncation (`maxlength`) appends an ellipsis and
    // cuts mid-paragraph, which cannot be re-shaped into readable bullets.
    maxlength: "0",
    format: "json",
  });
  if (officialOnly) params.set("feeds", STEAM_ANNOUNCEMENT_FEED);
  return `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?${params}`;
}

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
  const truncated = raw.filter((n: any) =>
    /…\s*$/.test(String(n?.contents ?? ""))
  ).length;
  if (truncated)
    notices.push(
      `${truncated} item${truncated === 1 ? " was" : "s were"} truncated upstream by Steam (the API's maxlength limit). Orbit requests full content, so this means the stored feed was cut before it reached us.`
    );
  if (options.officialOnly) {
    const hidden = mapped.length - items.length;
    if (hidden > 0)
      notices.push(
        `${hidden} of ${mapped.length} item${mapped.length === 1 ? "" : "s"} ${mapped.length === 1 ? "was" : "were"} not in Steam's app announcement feed, so the official-only filter hid ${hidden === 1 ? "it" : "them"}.`
      );
  }
  if (
    items.length &&
    !items.some((i: FeedItem) => i.attribution === "official")
  )
    notices.push(
      "None of these items is posted on this app's Steam announcement hub; they come from publisher feeds."
    );
  return { items, notices };
}

/**
 * Add Steam's **app** artwork to items that have no image of their own.
 *
 * Order of preference: an image inside the article body wins; otherwise the
 * game's store header/capsule image is used and explicitly labelled as app
 * artwork. At most one store lookup happens per poll (cached per app id), and a
 * failed lookup leaves the item without an image instead of inventing one.
 *
 * Exported for tests; the worker calls it through `pollSourceDetailed`.
 */
export async function withSteamAppArtwork(
  items: FeedItem[],
  appId: number,
  options: {
    cache?: Pick<SteamArtworkCache, "get">;
    enabled?: boolean;
  } = {}
): Promise<{ items: FeedItem[]; used: boolean; appName: string }> {
  const enabled = options.enabled ?? steamArtworkEnabled();
  if (!items.length || !enabled || items.every((item) => item.image))
    return { items, used: false, appName: "" };
  const art = await (options.cache ?? steamArtwork).get(appId);
  if (!art) return { items, used: false, appName: "" };
  const itemsWithArt = items.map((item) =>
    item.image
      ? item
      : {
          ...item,
          image: art.url,
          imageKind: "app-artwork" as const,
          imageAttribution: art.appName
            ? `${art.appName} · Steam store artwork`
            : "Steam store artwork",
        }
  );
  return { items: itemsWithArt, used: true, appName: art.appName };
}

export async function pollSourceDetailed(
  source: Resource
): Promise<FeedPollResult> {
  const d = source.data;
  if (d.adapter === "webhook") return { items: [], notices: [] };
  if (d.adapter === "steam") {
    if (!d.appId || !Number.isSafeInteger(d.appId) || d.appId <= 0)
      throw new Error("A Steam application ID is required");
    const json = (await officialJson(
      steamNewsUrl(d.appId, !!d.officialOnly)
    )) as { appnews?: { newsitems?: unknown } };
    const mapped = mapSteamNews(json?.appnews?.newsitems, {
      tags: d.tags ?? [],
      officialOnly: !!d.officialOnly,
    });
    const artwork = await withSteamAppArtwork(mapped.items, d.appId);
    const notices = [...mapped.notices];
    if (artwork.used)
      notices.push(
        "Items without their own image show the game's Steam store artwork, which is app artwork rather than a picture supplied by the article. Set STEAM_APP_ARTWORK=false on the worker to leave those items text-only."
      );
    else if (!mapped.items.some((item) => item.image))
      notices.push(
        "No article image and no store artwork were available for these items, so the cards are text-only."
      );
    return {
      items: artwork.items,
      notices: [...new Set(notices)],
    };
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
