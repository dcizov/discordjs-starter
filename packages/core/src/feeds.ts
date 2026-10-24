import { XMLParser } from "fast-xml-parser";
import { lookup } from "node:dns/promises";
import { Agent, request } from "undici";
import { assertFeedUrl, isPublicAddress, safeText } from "./safety";
import type { FeedItem, Resource } from "./types";
const MAX_BYTES = 1024 * 1024;
function upstreamError(status: number, retryAfter?: string) {
  let retryAfterMs: number | undefined;
  if (retryAfter) {
    const seconds = Number(retryAfter);
    retryAfterMs = Number.isFinite(seconds)
      ? seconds * 1000
      : new Date(retryAfter).getTime() - Date.now();
    if (!Number.isFinite(retryAfterMs)) retryAfterMs = undefined;
    else retryAfterMs = Math.max(1000, Math.min(retryAfterMs, 86400000));
  }
  return Object.assign(
    new Error(
      `Integration returned HTTP ${status}${retryAfterMs ? `; retry after ${Math.ceil(retryAfterMs / 1000)}s` : ""}`
    ),
    { status, retryAfterMs }
  );
}

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
export async function officialJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    throw upstreamError(
      res.status,
      res.headers.get("retry-after") ?? undefined
    );
  }
  const text = await res.text();
  if (text.length > 4 * MAX_BYTES)
    throw new Error("Integration response is too large");
  return JSON.parse(text);
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
export function matchesFilters(
  item: FeedItem,
  keywords: string[] = [],
  tags: string[] = []
) {
  const text = `${item.title} ${item.summary}`.toLocaleLowerCase();
  return (
    (!keywords.length ||
      keywords.some((k) => text.includes(k.toLocaleLowerCase()))) &&
    (!tags.length ||
      tags.some((t) =>
        item.tags.some((it) => it.toLowerCase() === t.toLowerCase())
      ))
  );
}
export async function searchGames(query: string) {
  const key = process.env.ITAD_API_KEY;
  if (!key)
    throw new Error("Add an IsThereAnyDeal API key to enable game search");
  if (query.trim().length < 2) throw new Error("Enter at least 2 characters");
  const data = await officialJson(
    `https://api.isthereanydeal.com/games/search/v1?key=${encodeURIComponent(key)}&title=${encodeURIComponent(query.slice(0, 100))}&results=15`
  );
  return data.map((g: any) => ({
    id: g.id,
    title: safeText(g.title, 150),
    slug: g.slug,
  }));
}
export async function pollDeals(resource: Resource): Promise<FeedItem[]> {
  const key = process.env.ITAD_API_KEY;
  if (!key) throw new Error("IsThereAnyDeal is not configured");
  const d = resource.data;
  const params = new URLSearchParams({
    key,
    country: d.region ?? "DE",
    shops: (d.stores ?? []).join(","),
  });
  let list: any[] = [];
  if (d.gameId) {
    const data = await officialJson(
      `https://api.isthereanydeal.com/games/prices/v3?${params}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify([d.gameId]),
      }
    );
    list = (data[0]?.deals ?? []).map((deal: any) => ({
      id: d.gameId,
      title: resource.name,
      deal,
      historyLow: data[0]?.historyLow,
    }));
  } else {
    params.set("sort", "-cut");
    params.set("limit", "50");
    params.set("nondeals", "false");
    const data = await officialJson(
      `https://api.isthereanydeal.com/deals/v2?${params}`
    );
    list = data.list ?? [];
  }
  return list
    .map((g: any): FeedItem => {
      const p = g.deal;
      const low =
        p?.historyLow?.amount ??
        g.historyLow?.all?.amount ??
        g.historyLow?.amount;
      return {
        id: `${g.id}:${p?.shop?.id}:${p?.price?.amountInt ?? p?.price?.amount}:${p?.timestamp ?? ""}`,
        title: safeText(g.title, 200),
        url: safeLink(p?.url ?? ""),
        summary: `${p?.price?.amount} ${p?.price?.currency} · ${p?.cut ?? 0}% off at ${safeText(p?.shop?.name ?? "store", 50)}`,
        price: p?.price?.amount,
        currency: p?.price?.currency,
        discount: p?.cut ?? 0,
        storeId: p?.shop?.id,
        historicalLow: typeof low === "number" && p?.price?.amount <= low,
        publishedAt: new Date().toISOString(),
        tags: ["Deals"],
      };
    })
    .filter(
      (i) =>
        typeof i.price === "number" &&
        i.currency === d.currency &&
        i.price <= d.maxPrice &&
        (i.discount ?? 0) >= d.minDiscount &&
        (!d.historicalLow || i.historicalLow) &&
        (!d.stores?.length || d.stores.includes(i.storeId))
    );
}
