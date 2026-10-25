import { routeFeedItem } from "@orbit/core/feed-routing";
import type { FeedItem, Resource } from "@orbit/core";
import { isDemo } from "@orbit/core/environment";
import { safeLink } from "@orbit/core/feeds";
import { dealQuality, eligibleDeal } from "@orbit/core/deal-policy";
import { createQueue } from "@orbit/core/queue";
import { getGuild, getResource, listResources, reserveDelivery } from "./store";
let queue: ReturnType<typeof createQueue> | undefined;
export async function dispatchItems(source: Resource, items: FeedItem[]) {
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
  for (const item of items) {
    if (
      source.kind === "deal" &&
      (!item.deal || !eligibleDeal(item.deal, current.data))
    )
      continue;
    const { normalized, destinations } = routeFeedItem(
      current,
      routes,
      item,
      guild.channels
    );
    for (const { channelId, settings } of destinations) {
      const delivery = await reserveDelivery({
        guildId: source.guildId,
        sourceId: source.id,
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
      });
      if (delivery) {
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
