"use client";
import { useState } from "react";
import { ImageOff } from "lucide-react";
import { Badge } from "./ui/primitives";
import type { NewsCard } from "@orbit/core/news-presentation";
import { cn } from "@/lib/utils";

function publishedLabel(value: string | null) {
  if (!value) return "Publication time unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Publication time unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/**
 * Fixed-size thumbnail: the box is reserved whether or not the third-party
 * image loads, so a broken or blocked image cannot shift the card, and a
 * failed load shows a neutral placeholder instead of a broken-image glyph.
 */
function NewsThumb({ card }: { card: NewsCard }) {
  const [failed, setFailed] = useState(false);
  if (!card.image) return null;
  return (
    <div className="size-16 shrink-0 overflow-hidden rounded-lg border bg-muted sm:size-20">
      {failed ? (
        <div
          className="flex size-full items-center justify-center text-muted-foreground"
          title="The image supplied by the source did not load."
        >
          <ImageOff aria-hidden className="size-5" />
          <span className="sr-only">Image unavailable</span>
        </div>
      ) : (
        // Deliberately a plain img: next/image would proxy third-party URLs
        // through this server, which turns a feed into an SSRF surface.
        <img
          src={card.image}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      )}
    </div>
  );
}

/**
 * A preview card is plain DOM built from normalized text. Fetched content is
 * never rendered as HTML, and images are the provider's own URL loaded
 * directly by the browser (no server-side proxy).
 *
 * Provider metadata that is technically true but uninteresting (no lead image,
 * which feed produced an item, why the link leaves Steam) lives in a collapsed
 * details block instead of filling the article body with diagnostics.
 */
export function NewsArticleCard({
  card,
  className,
}: {
  card: NewsCard;
  className?: string;
}) {
  const attributionTone =
    card.attribution === "official"
      ? "green"
      : card.attribution === "syndicated"
        ? "amber"
        : "neutral";
  return (
    <article
      className={cn(
        "overflow-hidden rounded-xl border-l-4 border-l-primary bg-muted/40",
        className
      )}
    >
      <div className="flex gap-4 p-4">
        <NewsThumb card={card} />
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <Badge tone={attributionTone}>{card.attributionLabel}</Badge>
            <span className="text-[10px] text-muted-foreground">
              {card.sourceLabel} · {publishedLabel(card.publishedAt)}
            </span>
            {card.imageKind === "app-artwork" ? (
              // Visible label, not a tooltip: a store image must never read as
              // a picture the article carried, on desktop or mobile.
              <span className="text-[10px] text-muted-foreground">
                · {card.imageAttribution || "Store artwork"}
              </span>
            ) : null}
          </div>
          {card.url ? (
            <a
              href={card.url}
              target="_blank"
              rel="noreferrer noopener"
              className="text-xs font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              {card.title}
            </a>
          ) : (
            <h3 className="text-xs font-semibold">{card.title}</h3>
          )}
          {card.excerpt ? (
            // pre-line keeps the paragraph/bullet shape from the normalizer and
            // adds no per-line margins, so a changelog stays compact.
            <p className="mt-2 whitespace-pre-line text-[12px] leading-[1.45] text-muted-foreground">
              {card.excerpt}
            </p>
          ) : (
            <p className="mt-2 text-[12px] italic text-muted-foreground">
              The source supplied no description for this item.
            </p>
          )}
          {card.url ? (
            <a
              href={card.url}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-2 inline-block text-[11px] font-medium text-primary underline-offset-2 hover:underline"
            >
              {card.linkLabel}
            </a>
          ) : null}
          {card.notices.length || card.subscriptionLabel ? (
            <details className="group mt-2 text-[10px] text-muted-foreground">
              <summary className="cursor-pointer select-none underline-offset-2 hover:underline">
                Preview details
              </summary>
              <ul className="mt-1 space-y-0.5">
                {card.subscriptionLabel ? (
                  <li>
                    Configured source: {card.subscriptionLabel} · feed:{" "}
                    {card.sourceLabel}
                  </li>
                ) : null}
                {card.notices.map((notice) => (
                  <li key={notice}>{notice}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </div>
    </article>
  );
}
