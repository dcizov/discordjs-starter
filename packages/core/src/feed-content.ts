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
 * Steam announcement markup, parsed rather than replaced.
 *
 * A real `ISteamNews` item (captured 2026-10-25, appid 730) looks like this:
 *
 *   [p]\[ UI ][/p][p]Demo/Replay viewer improvements:[/p][list]
 *   [*][p]Added a progress bar for demo/replay downloads[/p][/*]
 *   [*][p]Camera controls now use click-and-drag scheme[/p][/*][/list]
 *
 * Three properties defeat a replacement chain:
 * - `[/*]` closes an item and is followed directly by the next `[*]`, so a rule
 *   that only consumes `[*]` leaks `[/*]` into the visible text,
 * - lists nest inside list items (`[*]…[list][*]…[/list][/*]`), so `[/list]`
 *   alone cannot decide where a line ends,
 * - literal brackets are backslash-escaped (`\[ UI ]`) while `[/*]` is real
 *   markup, so "strip every bracketed expression" deletes author headings.
 *
 * One left-to-right scanner keeps the list stack and the escape state, and only
 * treats *known* tags as markup. Anything else stays literal.
 */
type SteamLine = {
  kind: "p" | "li";
  depth: number;
  marker: string;
  text: string;
};
type ListFrame = { ordered: boolean; index: number };

/** Inline tags: drop the tag, keep the text. */
const STEAM_INLINE_TAGS = new Set([
  "b",
  "i",
  "u",
  "s",
  "strike",
  "del",
  "em",
  "strong",
  "spoiler",
  "sub",
  "sup",
  "url",
]);

/** Block tags: a boundary, and the enclosing text still belongs to the text. */
const STEAM_BLOCK_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "quote",
  "code",
  "pre",
  "center",
  "section",
  "tr",
  "td",
  "th",
  "table",
  "br",
  "hr",
]);

/** Tags whose content is a URL or an id, never article prose. */
const STEAM_DROP_TAGS = new Set(["img", "video", "previewyoutube"]);

/**
 * Steam escapes a literal bracket or quote with a backslash (`\[ UI ]`,
 * `\"-allow_round_backup_files\"`). Exactly these four characters are
 * unescaped; blanket backslash removal would corrupt paths and Markdown.
 */
const STEAM_ESCAPABLE = new Set(["[", "]", "\\", '"']);

const STEAM_IMAGE_TOKENS = /\{STEAM_CLAN(?:_LOC)?_IMAGE\}/gi;

function scanSteamLines(raw: string): SteamLine[] {
  const lines: SteamLine[] = [];
  const stack: ListFrame[] = [];
  let buf = "";
  let skip: string | null = null;
  let pending: { marker: string; depth: number } | null = null;

  const flush = (kind: "p" | "li") => {
    const text = buf.replace(/\s+/g, " ").trim();
    buf = "";
    if (!text) return;
    lines.push({
      kind,
      depth: pending?.depth ?? Math.max(0, stack.length - 1),
      marker: pending?.marker ?? "",
      text,
    });
    pending = null;
  };
  // Inside a list every boundary ends a compact item; outside it ends a
  // paragraph. That distinction is what keeps bullets from double-spacing.
  const boundary = () => flush(stack.length ? "li" : "p");
  // One glyph per nesting level: tidyText collapses runs of spaces (and every
  // later plainText/excerpt pass does too), so indentation cannot survive.
  // Distinct markers keep the hierarchy readable in a card and in Discord.
  const NESTED_MARKERS = ["• ", "◦ ", "▪ "];
  const nextMarker = () => {
    const frame = stack[stack.length - 1];
    if (!frame) return "";
    if (frame.ordered) {
      frame.index += 1;
      return `${frame.index}. `;
    }
    return NESTED_MARKERS[
      Math.min(stack.length - 1, NESTED_MARKERS.length - 1)
    ];
  };

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (skip) {
      if (
        ch === "[" &&
        raw.slice(i, i + skip.length + 3).toLowerCase() === `[/${skip}]`
      ) {
        i += skip.length + 2;
        skip = null;
      }
      continue;
    }
    if (ch === "\\" && i + 1 < raw.length && STEAM_ESCAPABLE.has(raw[i + 1])) {
      buf += raw[i + 1];
      i += 1;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      boundary();
      continue;
    }
    if (ch !== "[") {
      buf += ch;
      continue;
    }
    const close = raw.indexOf("]", i);
    if (close === -1) {
      // Unterminated bracket: treat it as text rather than guessing.
      buf += raw.slice(i);
      break;
    }
    const body = raw.slice(i + 1, close).trim();
    const closing = body.startsWith("/");
    const name = (closing ? body.slice(1) : body.split("=")[0])
      .trim()
      .toLowerCase();
    const known =
      name === "*" ||
      name === "list" ||
      name === "olist" ||
      name === "noparse" ||
      STEAM_INLINE_TAGS.has(name) ||
      STEAM_BLOCK_TAGS.has(name) ||
      STEAM_DROP_TAGS.has(name);
    if (!known) {
      // `[ UI ]`, `[MISC]`, `[not markup]`: keep what the author wrote.
      buf += raw.slice(i, close + 1);
      i = close;
      continue;
    }
    i = close;
    if (name === "noparse") {
      // The body is literal by definition: keep it, minus its escapes.
      const end = raw.toLowerCase().indexOf("[/noparse]", i + 1);
      if (end === -1) continue;
      buf += raw.slice(i + 1, end).replace(/\\([[\]"])/g, "$1");
      i = end + "[/noparse]".length - 1;
      continue;
    }
    if (name === "list" || name === "olist") {
      boundary();
      if (!closing) stack.push({ ordered: name === "olist", index: 0 });
      else if (stack.length) stack.pop();
      continue;
    }
    if (name === "*") {
      boundary();
      if (!closing)
        pending = {
          marker: nextMarker(),
          depth: Math.max(0, stack.length - 1),
        };
      continue;
    }
    if (STEAM_BLOCK_TAGS.has(name)) {
      boundary();
      continue;
    }
    if (STEAM_DROP_TAGS.has(name)) {
      if (!closing) skip = name;
      continue;
    }
    // Inline formatting and `[url=…]` keep their text and add no boundary.
  }
  boundary();
  return lines;
}

/** Paragraphs get a blank line; list items stay on consecutive lines. */
function renderSteamLines(lines: SteamLine[]) {
  let out = "";
  for (const line of lines) {
    const item = line.kind === "li" || !!line.marker;
    const block = `${line.marker}${line.text}`;
    out += out ? `${item ? "\n" : "\n\n"}${block}` : block;
  }
  return out;
}

/** Steam `contents` (BBCode-ish markup plus occasional HTML) to plain text. */
export function steamMarkupToText(raw: string) {
  if (!raw) return "";
  const prepared = raw.replace(STEAM_IMAGE_TOKENS, "");
  return tidyText(renderSteamLines(scanSteamLines(htmlToText(prepared))));
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

/** A rendered list item: unordered glyphs or an ordered number. */
const BULLET_LINE = /^\s*(?:[•◦▪]|\d+\.)\s/;

export type ExcerptBounds = {
  chars?: number;
  paragraphs?: number;
  bullets?: number;
};

/**
 * Readable excerpt. A raw character slice of a changelog produces a wall of
 * bullets that fills half the card, so the shape is bounded first and the
 * character limit is applied last (never the other way round: truncating
 * mid-line would cut a bullet and look like corruption).
 */
export function excerpt(
  value: string,
  max = 480,
  bounds: Omit<ExcerptBounds, "chars"> = {}
) {
  const maxParagraphs = bounds.paragraphs ?? 3;
  const maxBullets = bounds.bullets ?? 6;
  const text = tidyText(value);
  if (!text) return "";
  const kept: string[] = [];
  let bullets = 0;
  for (const paragraph of text.split(/\n{2,}/)) {
    if (kept.length >= maxParagraphs) break;
    const lines = paragraph.split("\n");
    // A later section that cannot fit is dropped whole. Emitting "[ MISC ]" and
    // one of its five bullets is worse than not mentioning the section.
    if (
      kept.length > 0 &&
      lines.filter((line) => BULLET_LINE.test(line)).length >
        maxBullets - bullets
    )
      break;
    let exhausted = false;
    const keptLines: string[] = [];
    for (const line of lines) {
      if (BULLET_LINE.test(line)) {
        if (bullets >= maxBullets) {
          exhausted = true;
          break;
        }
        bullets += 1;
      }
      keptLines.push(line);
    }
    if (keptLines.length) kept.push(keptLines.join("\n"));
    if (exhausted) break;
  }
  // Never end on a section heading whose bullets were cut by the budget.
  while (kept.length > 1) {
    const last = kept[kept.length - 1];
    const singleLine = !last.includes("\n");
    if (
      singleLine &&
      !BULLET_LINE.test(last) &&
      last.length <= 60 &&
      !/[.!?。…:]$/.test(last)
    )
      kept.pop();
    else break;
  }
  const shaped = kept.join("\n\n");
  if (shaped.length <= max) return shaped;
  const window = shaped.slice(0, max + 1);
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
  const trimmed = shaped.slice(0, cut).replace(/[\s,;:–—-]+$/, "");
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
 * Steam's news API does not say "first party". What it *does* expose, verified
 * against live responses on 2026-10-25:
 *
 * - `feed_type`: `1` for the app's own announcement hub, `0` for syndicated
 *   partner/publisher feeds (Rock Paper Shotgun, PC Gamer, PlayGround.ru).
 * - `feedname`/`feedlabel`: the producing feed (`steam_community_announcements`
 *   → "Community Announcements", or the outlet's name).
 * - `is_external_url`: `true` for *every* item we captured, including Valve's
 *   own CS2 patch notes, because `url` is always a Steam redirector
 *   (`steamstore-a.akamaihd.net/news/externalpost/<feed>/<gid>`). It therefore
 *   says nothing about who wrote the item and is deliberately not used.
 *
 * `feed_type` is not in Valve's published `GetNewsForApp` documentation, so it
 * is treated as observed provider metadata: it separates "posted on the app's
 * announcement hub" from "syndicated publisher feed", and anything without
 * that evidence stays `unknown` rather than being promoted to official.
 */
export type SteamIdentity = {
  attribution: NewsAttribution;
  /** Producing feed, e.g. "Community Announcements" or "Rock, Paper, Shotgun". */
  feedLabel: string;
  /** Real outlet name when the item is syndicated, otherwise "". */
  publisher: string;
};

const STEAM_APP_FEEDS = new Set([
  "steam_community_announcements",
  "steam_release_notes",
  "steam_news",
]);

export function steamIdentity(item: {
  feed_type?: unknown;
  feedname?: unknown;
  feedlabel?: unknown;
  /** Accepted and deliberately ignored: see the note above. */
  is_external_url?: unknown;
  url?: unknown;
}): SteamIdentity {
  const feedname = String(item.feedname ?? "")
    .trim()
    .toLowerCase();
  const feedLabel = plainText(String(item.feedlabel ?? ""), 120).trim();
  const feedType = Number(item.feed_type);
  const appFeed = STEAM_APP_FEEDS.has(feedname);
  const official = Number.isFinite(feedType) ? feedType === 1 : appFeed;
  const label = feedLabel || (appFeed ? "Community Announcements" : feedname);
  if (official)
    return { attribution: "official", feedLabel: label, publisher: "" };
  if (label)
    return { attribution: "syndicated", feedLabel: label, publisher: label };
  return { attribution: "unknown", feedLabel: "Steam", publisher: "" };
}

/** Attribution only; see `steamIdentity` for the evidence behind it. */
export function steamAttribution(item: {
  feed_type?: unknown;
  feedname?: unknown;
  feedlabel?: unknown;
  is_external_url?: unknown;
  url?: unknown;
}): NewsAttribution {
  return steamIdentity(item).attribution;
}

/** Stable identity fallback when a provider omits guid/id. */
export function fallbackItemId(
  item: Pick<FeedItem, "title" | "url" | "publishedAt">
) {
  return item.url || `${item.title}:${item.publishedAt}`;
}
