import type { FeedItem, Resource } from "@orbit/core";
import { isDemo } from "@orbit/core";
import { matchesFilters, safeLink } from "@orbit/core/feeds";
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
    const normalized = {
      ...item,
      tags: [...new Set([...item.tags, ...(source.data.tags ?? [])])],
    };
    if (!matchesFilters(normalized, source.data.keywords ?? [])) continue;
    const destinations = new Map<string, Record<string, any>>();
    if (source.data.channelId)
      destinations.set(source.data.channelId, source.data);
    for (const route of routes)
      if (matchesFilters(normalized, route.data.keywords, route.data.tags))
        destinations.set(route.data.channelId, route.data);
    for (const [channelId, settings] of destinations) {
      if (!guild.channels.some((c) => c.id === channelId && c.type === "text"))
        continue;
      const delivery = await reserveDelivery({
        guildId: source.guildId,
        sourceId: source.id,
        externalId: item.id,
        title: item.title,
        url: safeLink(item.url),
        channelId,
        payload: {
          summary: item.summary,
          tags: normalized.tags,
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
  }
  return count;
}
