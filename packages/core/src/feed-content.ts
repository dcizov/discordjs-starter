import sanitizeHtml from "sanitize-html";
import type { FeedItem, NewsAttribution } from "./types";

/**
 * Provider-aware text normalization for feed content.
 *
 * Feeds and APIs hand us three different flavours of the same thing:
 * - HTML (RSS `description`/`content:encoded`, most publisher feeds),
 * - BBCode-ish markup mixed with HTML (Steam `ISteamNews` `contents`),
 * - already-plain text (signed webhooks).
 *
 * Stripping tags without respecting block boundaries is what concatenates
 * headings, list items and paragraphs into one run-on sentence. Every public
 * entry point here therefore converts structure to line breaks *before* tags
 * are removed, and never returns markup.
 */
export type TextFormat = "html" | "bbcode" | "plain";

const DROP_WITH_CONTENT =
  /<(script|style|iframe|object|embed|svg|math|template|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;

const INLINE_TAGS =
  /<\/?(?:a|abbr|b|strong|i|em|u|s|strike|del|ins|small|big|span|font|mark|sub|sup|code|kbd|samp|var|label|time|br|wbr|img|picture|source|video|audio|figure|figcaption)\b[^>]*>/gi;

const BLOCK_OPEN_TAGS =
  /<(?:p|div|section|article|header|footer|main|aside|nav|li|tr|h[1-6]|blockquote|pre|table|thead|tbody|tfoot|ul|ol|dl|dt|dd|center|details|summary)\b[^>]*>/gi;

const BLOCK_CLOSE_TAGS =
  /<\/(?:p|div|section|article|header|footer|main|aside|nav|tr|h[1-6]|blockquote|pre|table|thead|tbody|tfoot|ul|ol|dl|dt|dd|center|details|summary)\s*>/gi;

/** Collapse whitespace while keeping paragraph and list boundaries. */
export function tidyText(value: string) {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  minus: "−",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  prime: "′",
  Prime: "″",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  times: "×",
  divide: "÷",
  middot: "·",
  bull: "•",
  sect: "§",
  para: "¶",
  permil: "‰",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  laquo: "«",
  raquo: "»",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  plusmn: "±",
  le: "≤",
  ge: "≥",
  ne: "≠",
  infin: "∞",
  szlig: "ß",
  ccedil: "ç",
  ntilde: "ñ",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  uuml: "ü",
  ouml: "ö",
  auml: "ä",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  dagger: "†",
  Dagger: "‡",
};

/**
 * Decode the entity forms feeds actually use. sanitize-html strips tags but
 * re-encodes ampersands in its text output, so decoding happens explicitly and
 * *after* sanitizing — decoded markup stays inert text.
 */
export function decodeHtmlEntities(value: string) {
  return value.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (match, body: string) => {
      if (body.startsWith("#")) {
        const hex = body[1]?.toLowerCase() === "x";
        const code = hex
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return "";
        return String.fromCodePoint(code);
      }
      return (
        NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()] ?? match
      );
    }
  );
}

function decodeEntities(value: string) {
  return decodeHtmlEntities(
    sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} })
  );
}

export function htmlToText(raw: string) {
  const structured = raw
    .replace(DROP_WITH_CONTENT, "\n")
    .replace(/<(?:br|hr)\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    // The bullet marker already ends the line; a newline for </li> too would
    // put a blank line between every list item.
    .replace(/<\/li\s*>/gi, "")
    .replace(BLOCK_OPEN_TAGS, "\n")
    .replace(BLOCK_CLOSE_TAGS, "\n")
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(INLINE_TAGS, "");
  return tidyText(decodeEntities(structured));
}

/**
 * Steam announcement markup. Steam mixes BBCode-like constructs with real HTML
 * and legacy `{STEAM_CLAN_IMAGE}` tokens, so BBCode is expanded to plain text
 * first and the HTML pass runs afterwards on the same string.
 */
export function steamMarkupToText(raw: string) {
  const expanded = raw
    .replace(
      /\{STEAM_CLAN_IMAGE\}/gi,
      "https://clan.cloudflare.steamstatic.com/images"
    )
    .replace(
      /\{STEAM_CLAN_LOC_IMAGE\}/gi,
      "https://clan.cloudflare.steamstatic.com/images"
    )
    .replace(/(clan\.cloudflare\.steamstatic\.com\/images)\/+/gi, "$1/")
    .replace(/\[img(?:=[^\]]*)?\][\s\S]*?\[\/img\]/gi, "\n")
    .replace(/\[previewyoutube=[^\]]*\][\s\S]*?\[\/previewyoutube\]/gi, "\n")
    .replace(/\[video\][\s\S]*?\[\/video\]/gi, "\n")
    .replace(
      /\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi,
      (_m, href: string, label: string) => (label || href).trim()
    )
    .replace(/\[url\]([\s\S]*?)\[\/url\]/gi, (_m, href: string) => href.trim())
    .replace(
      /\[list(?:=[^\]]*)?\]([\s\S]*?)\[\/list\]/gi,
      (_m, body: string) => `\n${body}\n`
    )
    .replace(/\s*\[\*\]\s*/gi, "\n• ")
    .replace(
      /\[\/?(?:h[1-6]|p|quote|table|tr|td|th|center|hr|code|pre|noparse|section)\]/gi,
      "\n"
    )
    .replace(
      /\[\/?(?:b|i|u|s|strike|spoiler|sub|sup|noparse|url|img|list)\]/gi,
      ""
    )
    .replace(/\[[a-z][a-z0-9]*=[^\]]*\]/gi, "");
  return tidyText(htmlToText(expanded));
}

export function normalizeFeedText(raw: string, format: TextFormat) {
  if (!raw) return "";
  if (format === "bbcode") return steamMarkupToText(raw);
  if (format === "html") return htmlToText(raw);
  return tidyText(decodeEntities(raw));
}

/**
 * Neutralize mentions and control characters without truncating mid-word.
 * `safeText` stays responsible for the hard Discord limits at the edge.
 */
export function plainText(value: string, max = 4000) {
  return tidyText(
    // Decode first: `&lt;em&gt;` must be recognized as markup and stripped,
    // not rendered as literal angle brackets in a title.
    decodeEntities(decodeHtmlEntities(value))
      .replace(/@(everyone|here)/gi, "＠$1")
      .replace(/<@([!&]?)(\d+)>/g, "[mention]")
  ).slice(0, max);
}

/**
 * Readable excerpt: prefers paragraph/sentence boundaries over a hard slice so
 * a card never ends with half a word or a joined line.
 */
export function excerpt(value: string, max = 480) {
  const text = tidyText(value);
  if (text.length <= max) return text;
  const window = text.slice(0, max + 1);
  const punctuated = Math.max(
    window.lastIndexOf("\n\n"),
    window.lastIndexOf(". "),
    window.lastIndexOf("! "),
    window.lastIndexOf("? "),
    window.lastIndexOf("。")
  );
  const space = window.lastIndexOf(" ");
  const cut =
    punctuated >= max * 0.55
      ? punctuated + 1
      : space >= max * 0.55
        ? space
        : max;
  const trimmed = text.slice(0, cut).replace(/[\s,;:–—-]+$/, "");
  if (!trimmed) return "";
  return /[.!?。…]$/.test(trimmed) ? trimmed : `${trimmed}…`;
}

const IMAGE_HOST_BLOCKLIST =
  /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|test|invalid|example)$/;

/**
 * Provider-supplied image URLs only. This is a syntactic gate, not a fetcher:
 * the dashboard renders the URL directly (never proxied through our server) and
 * Discord fetches it for the embed, so a private/odd destination is refused
 * here instead of relying on a downstream proxy to be safe.
 */
export function safeImageUrl(value: string) {
  if (!value) return "";
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) return "";
    if (url.port && url.port !== "443") return "";
    const host = url.hostname.toLowerCase();
    if (
      !host.includes(".") ||
      host.includes(":") ||
      IMAGE_HOST_BLOCKLIST.test(host)
    )
      return "";
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return "";
    if (!/\.(png|jpe?g|webp|gif|avif)$/i.test(url.pathname)) return "";
    return url.toString().slice(0, 2000);
  } catch {
    return "";
  }
}

const IMAGE_EXTENSION = /\.(png|jpe?g|webp|gif|avif)(?:[?#].*)?$/i;

/** First provider-supplied image inside article markup (BBCode or HTML). */
export function imageFromMarkup(raw: string) {
  if (!raw) return "";
  const bbcode = /\[img(?:=[^\]]*)?\]([^[]+)\[\/img\]/i.exec(raw);
  if (bbcode) {
    const candidate = safeImageUrl(
      bbcode[1]
        .replace(
          /\{STEAM_CLAN_IMAGE\}/gi,
          "https://clan.cloudflare.steamstatic.com/images"
        )
        .replace(/(clan\.cloudflare\.steamstatic\.com\/images)\/+/gi, "$1/")
    );
    if (candidate) return candidate;
  }
  const html = /<img\b[^>]*\bsrc=["']([^"']+)["']/i.exec(raw);
  if (html) {
    const candidate = safeImageUrl(
      html[1]
        .replace(/&amp;/g, "&")
        .replace(
          /\{STEAM_CLAN_IMAGE\}/gi,
          "https://clan.cloudflare.steamstatic.com/images"
        )
        .replace(/(clan\.cloudflare\.steamstatic\.com\/images)\/+/gi, "$1/")
    );
    if (candidate) return candidate;
  }
  const loose = /https?:\/\/[^\s"'[\]<>]+/gi;
  for (const match of raw.match(loose) ?? []) {
    if (!IMAGE_EXTENSION.test(match)) continue;
    const candidate = safeImageUrl(match);
    if (candidate) return candidate;
  }
  return "";
}

/**
 * Steam's news API mixes first-party announcements with external/syndicated
 * items. Classification uses only the metadata Steam returns; anything we
 * cannot attribute stays "unknown" instead of being labelled official.
 */
const STEAM_OFFICIAL_FEEDS = new Set([
  "steam_community_announcements",
  "steam_release_notes",
  "steam_news",
]);

const STEAM_HOSTS =
  /(^|\.)(steamcommunity\.com|steampowered\.com|steamstatic\.com)$/i;

export function steamAttribution(item: {
  is_external_url?: unknown;
  feedname?: unknown;
  url?: unknown;
}): NewsAttribution {
  let host = "";
  try {
    host = new URL(String(item.url ?? "")).hostname;
  } catch {
    host = "";
  }
  if (item.is_external_url === true || item.is_external_url === "true")
    return "external";
  if (host && !STEAM_HOSTS.test(host)) return "external";
  const feed = String(item.feedname ?? "").toLowerCase();
  if (STEAM_OFFICIAL_FEEDS.has(feed)) return "official";
  return "unknown";
}

/** Stable identity fallback when a provider omits guid/id. */
export function fallbackItemId(
  item: Pick<FeedItem, "title" | "url" | "publishedAt">
) {
  return item.url || `${item.title}:${item.publishedAt}`;
}
