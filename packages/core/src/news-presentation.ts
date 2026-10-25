import { excerpt, plainText, safeImageUrl } from "./feed-content";
import { safeLink, safeText } from "./safety";
import type { FeedItem, NewsAttribution } from "./types";
export type { NewsAttribution } from "./types";

/**
 * One presentation policy for both the dashboard test flight and Discord
 * delivery. A preview that renders differently from the delivered embed is how
 * malformed content reaches production unnoticed.
 *
 * Attribution wording is deliberately weaker than the data:
 * Steam says a post lives on the app's announcement hub or comes from a named
 * publisher feed. It never says "first party", and `is_external_url` does not
 * mean the item is somebody else's (it is `true` even for Valve's own patch
 * notes, because the API always links through a Steam redirector).
 */
export const ATTRIBUTION_LABELS: Record<NewsAttribution, string> = {
  official: "App announcement",
  syndicated: "Third-party publisher",
  unknown: "Publisher not confirmed",
};

export const NEWS_LIMITS = {
  title: 256,
  excerpt: 480,
  /** Shape limits: a changelog must not fill the card with bullets. */
  excerptParagraphs: 3,
  excerptBullets: 5,
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
  /** The feed that produced the item, not the administrator's label. */
  sourceLabel: string;
  /** The administrator's source name, when it adds information. */
  subscriptionLabel: string;
  attribution: NewsAttribution;
  attributionLabel: string;
  /** Wording that matches what the link actually opens. */
  linkLabel: string;
  publisher: string;
  tags: string[];
  /** Metadata gaps and filtering notes, surfaced in preview diagnostics. */
  notices: string[];
};

export type NewsPresentationOptions = {
  /** The administrator's name for the configured source. */
  sourceName?: string;
  /** Simulated demo item: no provider was contacted, so gaps do not apply. */
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

function attributionLabel(attribution: NewsAttribution, publisher: string) {
  if (attribution === "syndicated" && publisher)
    return `Republished from ${publisher}`;
  return ATTRIBUTION_LABELS[attribution];
}

/**
 * "Read more from <admin label>" implied the configured source wrote the
 * article. The link opens the publisher's page (through a Steam redirect for
 * Steam items), so the label names where it actually goes.
 */
export function linkLabelFor(
  attribution: NewsAttribution,
  publisher: string
): string {
  if (attribution === "official") return "Read the announcement";
  if (attribution === "syndicated" && publisher)
    return `Read the article at ${publisher}`;
  return "Read article";
}

export function newsCard(
  item: Pick<FeedItem, "id" | "title" | "url" | "summary"> &
    Partial<
      Pick<
        FeedItem,
        | "image"
        | "attribution"
        | "publishedAt"
        | "tags"
        | "sourceLabel"
        | "publisher"
      >
    >,
  options: NewsPresentationOptions = {}
): NewsCard {
  const notices: string[] = [];
  const title =
    plainText(item.title ?? "", NEWS_LIMITS.title) || "Untitled update";
  const body = plainText(item.summary ?? "", NEWS_LIMITS.description);
  const text = excerpt(body, options.excerptLength ?? NEWS_LIMITS.excerpt, {
    paragraphs: NEWS_LIMITS.excerptParagraphs,
    bullets: NEWS_LIMITS.excerptBullets,
  });
  const url = safeLink(item.url ?? "");
  const image = item.image ? safeImageUrl(item.image) : "";
  const publishedAt = isoOrNull(item.publishedAt);
  const attribution: NewsAttribution = item.attribution ?? "unknown";
  const publisher = plainText(item.publisher ?? "", 80);
  // Provider identity wins over the administrator's subscription label: "CS2"
  // is what somebody configured, "Rock, Paper, Shotgun" is who wrote it.
  const providerLabel = plainText(item.sourceLabel ?? "", 120);
  const subscriptionLabel = plainText(options.sourceName ?? "", 120);
  const sourceLabel = providerLabel || subscriptionLabel || "News source";
  // A simulated demo item contacted no provider, so metadata gaps do not apply.
  if (!options.simulated) {
    if (!text) notices.push("No description supplied by the source.");
    if (!url) notices.push("No usable article link supplied by the source.");
    if (!publishedAt)
      notices.push("No publication time supplied by the source.");
    if (item.publishedAt && !publishedAt)
      notices.push("The supplied publication time could not be parsed.");
    if (attribution === "unknown")
      notices.push("The provider did not identify the publisher.");
  }
  return {
    id: plainText(item.id ?? "", 200),
    title,
    url,
    excerpt: text,
    image: image || null,
    publishedAt,
    sourceLabel,
    subscriptionLabel:
      subscriptionLabel && subscriptionLabel !== sourceLabel
        ? subscriptionLabel
        : "",
    attribution,
    attributionLabel: attributionLabel(attribution, publisher),
    linkLabel: linkLabelFor(attribution, publisher),
    publisher,
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
        | "image"
        | "attribution"
        | "publishedAt"
        | "tags"
        | "sourceLabel"
        | "publisher"
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
