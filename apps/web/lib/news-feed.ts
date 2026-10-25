import type { NewsCard } from "@orbit/core/news-presentation";

/**
 * View model for the news preview feed.
 *
 * The dashboard renders provider data, so the decisions that matter — which
 * item gets the artwork, what the heading calls the source, how a date is
 * written, which badge tone an attribution gets — are plain functions here and
 * are unit-tested without a browser. `news-preview-feed.tsx` only lays them out.
 */

/** UTC date, or an honest gap marker; never "Invalid Date". */
export function postedLabel(value: string | null) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** The scannable line under a title: posted date first, then the feed. */
export function feedMetaLine(
  card: Pick<NewsCard, "publishedAt" | "sourceLabel">
) {
  return `Posted ${postedLabel(card.publishedAt)} · ${card.sourceLabel || "Unknown source"}`;
}

export function attributionTone(
  card: Pick<NewsCard, "attribution">
): "green" | "amber" | "neutral" {
  return card.attribution === "official"
    ? "green"
    : card.attribution === "syndicated"
      ? "amber"
      : "neutral";
}

export type NewsFeedSection = {
  /** Newest item: gets the artwork and the body. */
  lead: NewsCard | null;
  /** Everything else, in provider order. */
  more: NewsCard[];
  /** "More updates from <source>" — names the subscription when known. */
  moreHeading: string;
};

export function newsFeedModel(
  items: NewsCard[],
  sourceName?: string
): NewsFeedSection {
  const [lead, ...more] = items;
  const name =
    (sourceName ?? "").trim() ||
    (lead?.subscriptionLabel ?? "").trim() ||
    "this source";
  return { lead: lead ?? null, more, moreHeading: `More updates from ${name}` };
}
