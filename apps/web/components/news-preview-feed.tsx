"use client";
import { useState } from "react";
import { CalendarDays, ImageOff } from "lucide-react";
import type { NewsCard } from "@orbit/core/news-presentation";
import { Badge } from "./ui/primitives";
import { cn } from "@/lib/utils";
import {
  attributionTone,
  feedMetaLine,
  newsFeedModel,
  postedLabel,
} from "@/lib/news-feed";

/**
 * Provider artwork with a reserved, fixed-ratio frame.
 *
 * The frame is always rendered when a card has an image, so a third-party image
 * that never loads cannot reflow the feed. A failed load shows a neutral
 * placeholder instead of a broken-image glyph.
 */
function CoverArt({ url, className }: { url: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-muted text-muted-foreground",
          className
        )}
        title="This image did not load."
      >
        <ImageOff aria-hidden className="size-5" />
        <span className="sr-only">Image unavailable</span>
      </div>
    );
  return (
    // Plain img on purpose: next/image would proxy third-party URLs through
    // this server, which turns a news feed into an SSRF surface.
    <img
      src={url}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn("object-cover", className)}
    />
  );
}

/**
 * One update, laid out like an event card: artwork, the attribution badge and
 * the posted date are the scannable line, the body is the readable part.
 *
 * Every label here is real provider data. Orbit's news adapters expose no event
 * "type" or community reaction counts, so those are not invented; the badge
 * says who published the item and the tag row shows the provider's own tags.
 */
export function NewsFeatureCard({ card }: { card: NewsCard }) {
  return (
    <article className="overflow-hidden rounded-xl border bg-card">
      {/* 16:9 keeps a wide Steam header from pushing the text off screen. */}
      <CoverArt url={card.image ?? ""} className="aspect-[16/9] w-full" />
      <div className="space-y-2 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={attributionTone(card)}>{card.attributionLabel}</Badge>
          {card.imageKind === "app-artwork" ? (
            <Badge tone="neutral">
              {card.imageAttribution || "Store artwork"}
            </Badge>
          ) : null}
          {card.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} tone="neutral">
              {tag}
            </Badge>
          ))}
        </div>
        {card.url ? (
          <h3 className="text-sm font-semibold leading-snug">
            <a
              href={card.url}
              target="_blank"
              rel="noreferrer noopener"
              className="underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              {card.title}
            </a>
          </h3>
        ) : (
          <h3 className="text-sm font-semibold leading-snug">{card.title}</h3>
        )}
        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <CalendarDays aria-hidden className="size-3 shrink-0" />
          {feedMetaLine(card)}
        </p>
        {card.excerpt ? (
          <p className="line-clamp-4 whitespace-pre-line text-[12px] leading-[1.5] text-muted-foreground">
            {card.excerpt}
          </p>
        ) : (
          <p className="text-[12px] italic text-muted-foreground">
            The source supplied no description.
          </p>
        )}
        {card.url ? (
          <a
            href={card.url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-block text-[11px] font-medium text-primary underline-offset-2 hover:underline"
          >
            {card.linkLabel}
          </a>
        ) : null}
        {card.subscriptionLabel ? (
          // The configured label and the provider feed are different facts;
          // keep the distinction one click away rather than in the body.
          <details className="text-[10px] text-muted-foreground">
            <summary className="cursor-pointer select-none underline-offset-2 hover:underline">
              Preview details
            </summary>
            <p className="mt-1">
              Configured source: {card.subscriptionLabel} · feed:{" "}
              {card.sourceLabel}
            </p>
          </details>
        ) : null}
      </div>
    </article>
  );
}

/**
 * Compact row for the "more updates" list: date first, then the title, so a
 * reader can scan chronology the way an event list is normally read.
 */
function NewsFeedRow({ card }: { card: NewsCard }) {
  return (
    <li className="flex items-start gap-3 border-b border-border/70 py-2.5 last:border-0">
      {card.image ? (
        <CoverArt
          url={card.image}
          className="mt-0.5 size-10 shrink-0 rounded-md border"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="text-[10px] text-muted-foreground">
          {postedLabel(card.publishedAt)}
        </p>
        {card.url ? (
          <a
            href={card.url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-[12px] font-medium leading-snug underline-offset-2 hover:underline"
          >
            {card.title}
          </a>
        ) : (
          <span className="text-[12px] font-medium leading-snug">
            {card.title}
          </span>
        )}
      </div>
    </li>
  );
}

/**
 * A news preview laid out as a feed: the newest item gets the artwork and the
 * body, the rest become a compact dated list under a heading that names the
 * source (e.g. "More updates from CS2 updates").
 *
 * Everything comes from the single poll that produced this preview — the list
 * is not a second request, and nothing here can deliver a message.
 */
export function NewsPreviewFeed({
  items,
  sourceName,
}: {
  items: NewsCard[];
  sourceName?: string;
}) {
  const { lead, more, moreHeading } = newsFeedModel(items, sourceName);
  if (!lead) return null;
  return (
    <div className="space-y-3">
      <NewsFeatureCard card={lead} />
      {more.length ? (
        <div className="rounded-xl border bg-muted/20 px-3 py-2">
          <h4 className="pt-1 text-[11px] font-medium text-muted-foreground">
            {moreHeading}
          </h4>
          <ul>
            {more.map((card) => (
              <NewsFeedRow key={card.id || card.title} card={card} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
