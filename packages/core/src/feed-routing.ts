import type { FeedItem, GuildChannel, Resource } from "./types";
export type RoutingSample = Pick<FeedItem, "title" | "summary" | "tags">;
export function matchesFilters(
  item: RoutingSample,
  keywords: string[] = [],
  tags: string[] = []
) {
  const text = `${item.title} ${item.summary}`.toLocaleLowerCase();
  return (
    (!keywords.length ||
      keywords.some((k) => text.includes(k.toLocaleLowerCase()))) &&
    (!tags.length ||
      tags.some((t) =>
        item.tags.some((it) => it.toLowerCase() === t.toLowerCase())
      ))
  );
}
export type FeedDestination = {
  channelId: string;
  settings: {
    notificationRoleId?: string;
    embedColor?: string;
    includeSummary?: boolean;
  };
  matchedBy: string[];
};
/** Same deterministic matcher for outbox delivery and protected no-I/O previews. Last matching route wins its settings, as before. */
export function routeFeedItem<T extends RoutingSample>(
  source: Resource,
  routes: Resource[],
  item: T,
  channels: GuildChannel[]
) {
  const normalized = {
    ...item,
    tags: [...new Set([...item.tags, ...(source.data.tags ?? [])])],
  };
  const destinations = new Map<string, FeedDestination>();
  const accepted =
    source.enabled && matchesFilters(normalized, source.data.keywords ?? []);
  if (accepted) {
    if (source.data.channelId)
      destinations.set(source.data.channelId, {
        channelId: source.data.channelId,
        settings: source.data,
        matchedBy: ["Source destination"],
      });
    for (const route of routes)
      if (
        route.guildId === source.guildId &&
        route.kind === "route" &&
        route.enabled &&
        route.data.sourceIds.includes(source.id) &&
        matchesFilters(normalized, route.data.keywords, route.data.tags)
      ) {
        destinations.set(route.data.channelId, {
          channelId: route.data.channelId,
          settings: route.data,
          matchedBy: [
            ...(destinations.get(route.data.channelId)?.matchedBy ?? []),
            route.name,
          ],
        });
      }
  }
  const missingChannels = [...destinations.keys()].filter(
    (id) => !channels.some((c) => c.id === id && c.type === "text")
  );
  return {
    normalized,
    accepted,
    missingChannels,
    destinations: [...destinations.values()].filter(
      (d) => !missingChannels.includes(d.channelId)
    ),
  };
}
export type NewsRoutingPreview = {
  sourceName: string;
  matched: boolean;
  blocked: string[];
  normalizedTags: string[];
  destinations: {
    channelId: string;
    channelName: string;
    matchedBy: string[];
    permissions: "present" | "missing" | "unknown";
    notificationRole: string | null;
  }[];
  fetchPerformed: false;
  sendPerformed: false;
  deliveryVerified: false;
};
