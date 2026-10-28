import { routeFeedItem } from "@orbit/core/feed-routing";
import { feedIdentity } from "@orbit/core/feed-identity";
import type { FeedItem, Resource } from "@orbit/core";
import { isDemo } from "@orbit/core/environment";
import { safeLink } from "@orbit/core/feeds";
import { dealQuality, eligibleDeal } from "@orbit/core/deal-policy";
import { createQueue } from "@orbit/core/queue";
import { getGuild, getResource, listResources, reserveDelivery } from "./store";
let queue: ReturnType<typeof createQueue> | undefined;
/**
 * Route one poll's items for one source and enqueue the deliveries that survive
 * routing, dedupe and policy.
 *
 * Silently returns `0` (rather than throwing) when the guild is uninstalled, the
 * module is off, or the source was disabled after the fetch: those are normal
 * races with a dashboard edit, not failures that should retry a feed poll. Each
 * accepted item is reserved first, so a crashed poll re-runs without duplicating
 * posts. Demo mode throws instead — demo must never reach Discord. Never call this
 * from a dashboard request; it runs in the worker with the bot's queue.
 *
 * `options.postNewest` primes the source: only that many of the newest items are
 * posted, and every other item is reserved as `skipped` so it counts as seen.
 * Priming without the reservation would only defer the problem — the next poll
 * would find the same back catalogue with no record of having seen it.
 */
export async function dispatchItems(
  source: Resource,
  items: FeedItem[],
  options: { postNewest?: number } = {}
) {
  if (isDemo())
    throw new Error("Live delivery dispatch is disabled in demo mode");
  const guild = await getGuild(source.guildId),
    current = await getResource(source.guildId, source.id);
  if (
    !guild?.installed ||
    !current?.enabled ||
    !guild.config.modules[source.kind === "deal" ? "deals" : "news"]
  )
    return 0;
  const routes =
    source.kind === "source"
      ? (await listResources(source.guildId, "route")).filter(
          (r) => r.enabled && r.data.sourceIds.includes(source.id)
        )
      : [];
  let count = 0;
  // Computed once, not per item: the identity belongs to the source, and it
  // must be identical for every item of this poll.
  const identity = feedIdentity(source);

  for (const [index, item] of items.entries()) {
    if (
      source.kind === "deal" &&
      (!item.deal || !eligibleDeal(item.deal, current.data))
    )
      continue;
    // Priming only ever applies to a source, and only to a poll that asked
    // for it. `undefined` means "post everything that is new".
    const primed =
      options.postNewest !== undefined && index >= options.postNewest;
    const { normalized, destinations } = routeFeedItem(
      current,
      routes,
      item,
      guild.channels
    );
    for (const { channelId, settings } of destinations) {
      const delivery = await reserveDelivery(
        {
          guildId: source.guildId,
          sourceId: source.id,
          // Deduplicated on the feed, not on the source row: deleting and
          // recreating a source for the same URL must not re-post the feed.
          feedIdentity: identity,
          externalId: item.id,
          title: item.title,
          url: source.kind === "deal" ? item.url : safeLink(item.url),
          channelId,
          payload: {
            ...(source.kind === "deal" && item.deal ? { deal: item.deal } : {}),
            summary: item.summary,
            tags: normalized.tags,
            image: item.image ?? null,
            attribution: item.attribution ?? "unknown",
            providerLabel: item.sourceLabel ?? "",
            publisher: item.publisher ?? "",
            publishedAt: item.publishedAt,
            notificationRoleId:
              settings.notificationRoleId || guild.config.notificationRoleId,
            color: settings.embedColor ?? "#8b5cf6",
            includeSummary: settings.includeSummary !== false,
            sourceName: source.name,
          },
        },
        { primed }
      );
      if (delivery && !primed) {
        queue ??= createQueue("community-jobs");
        await queue.add(
          "deliver",
          { deliveryId: delivery.id },
          { jobId: `delivery-${delivery.id}` }
        );
        count++;
      }
    }
    // Apply the cap AFTER deduplication; already-seen top games must not starve
    // later eligible games forever, or create more posts on every timestamp tick.
    if (
      source.kind === "deal" &&
      count >= dealQuality(current.data).maxPostsPerCheck
    )
      break;
  }
  return count;
}
