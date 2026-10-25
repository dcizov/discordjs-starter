import { excerpt, plainText, safeImageUrl } from "./feed-content";
import { safeLink, safeText } from "./safety";
import type { FeedItem, NewsAttribution } from "./types";
export type { NewsAttribution } from "./types";

/**
 * One presentation policy for both the dashboard test flight and Discord
 * delivery. A preview that renders differently from the delivered embed is how
 * malformed content reaches production unnoticed.
 */
export const ATTRIBUTION_LABELS: Record<NewsAttribution, string> = {
  official: "Official announcement",
  external: "External link, not a first-party post",
  unknown: "Publisher not confirmed by the feed",
};

export const NEWS_LIMITS = {
  title: 256,
  excerpt: 480,
  description: 4096,
  footer: 2048,
  image: 2000,
} as const;

export type NewsCard = {
  id: string;
  title: string;
  url: string;
  excerpt: string;
  image: string | null;
  publishedAt: string | null;
  sourceLabel: string;
  attribution: NewsAttribution;
  attributionLabel: string;
  tags: string[];
  /** Missing metadata and filtering notes, surfaced instead of invented. */
  notices: string[];
};

export type NewsPresentationOptions = {
  sourceName?: string;
  /** Simulated demo item: no provider was contacted, so metadata notices do not apply. */
  simulated?: boolean;
  includeSummary?: boolean;
  color?: string;
  excerptLength?: number;
};

function isoOrNull(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function newsCard(
  item: Pick<FeedItem, "id" | "title" | "url" | "summary"> &
    Partial<
      Pick<
        FeedItem,
        "image" | "attribution" | "publishedAt" | "tags" | "sourceLabel"
      >
    >,
  options: NewsPresentationOptions = {}
): NewsCard {
  const notices: string[] = [];
  const title =
    plainText(item.title ?? "", NEWS_LIMITS.title) || "Untitled update";
  const body = plainText(item.summary ?? "", NEWS_LIMITS.description);
  const text = excerpt(body, options.excerptLength ?? NEWS_LIMITS.excerpt);
  const url = safeLink(item.url ?? "");
  const image = item.image ? safeImageUrl(item.image) : "";
  const publishedAt = isoOrNull(item.publishedAt);
  const attribution: NewsAttribution = item.attribution ?? "unknown";
  const sourceLabel =
    plainText(options.sourceName ?? item.sourceLabel ?? "", 120) ||
    "News source";
  // A simulated demo item contacted no provider, so metadata gaps do not apply.
  if (!options.simulated) {
    if (!text) notices.push("No description supplied by the source.");
    if (!url) notices.push("No usable article link supplied by the source.");
    if (!publishedAt)
      notices.push("No publication time supplied by the source.");
    if (item.publishedAt && !publishedAt)
      notices.push("The supplied publication time could not be parsed.");
    if (!image) notices.push("No provider-supplied image.");
    if (attribution === "unknown")
      notices.push("Steam metadata did not identify the publisher.");
  }
  return {
    id: plainText(item.id ?? "", 200),
    title,
    url,
    excerpt: text,
    image: image || null,
    publishedAt,
    sourceLabel,
    attribution,
    attributionLabel: ATTRIBUTION_LABELS[attribution],
    tags: (item.tags ?? []).map((tag) => plainText(tag, 30)).filter(Boolean),
    notices,
  };
}

export type DiscordFeedEmbed = {
  title: string;
  url?: string;
  description?: string;
  color: number;
  image?: { url: string };
  footer: { text: string };
  timestamp?: string;
  author?: { name: string };
};

function embedColor(value: unknown) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? parseInt(value.slice(1), 16)
    : 0x9b7ada;
}

/**
 * Discord's own limits, applied once so preview and delivery cannot drift.
 * Unsupported or missing metadata is omitted, never fabricated.
 */
export function feedEmbed(
  item: Pick<FeedItem, "id" | "title" | "url" | "summary"> &
    Partial<
      Pick<
        FeedItem,
        "image" | "attribution" | "publishedAt" | "tags" | "sourceLabel"
      >
    >,
  options: NewsPresentationOptions = {}
): DiscordFeedEmbed {
  const card = newsCard(item, options);
  const description = options.includeSummary === false ? "" : card.excerpt;
  const attribution =
    card.attribution === "unknown" ? "" : ` · ${card.attributionLabel}`;
  const footer = safeText(
    `${card.sourceLabel}${attribution} · via Orbit`,
    NEWS_LIMITS.footer
  );
  return {
    title: card.title,
    ...(card.url ? { url: card.url } : {}),
    ...(description
      ? { description: safeText(description, NEWS_LIMITS.description) }
      : {}),
    color: embedColor(options.color),
    ...(card.image
      ? { image: { url: card.image.slice(0, NEWS_LIMITS.image) } }
      : {}),
    footer: { text: footer },
    ...(card.publishedAt ? { timestamp: card.publishedAt } : {}),
  };
}
