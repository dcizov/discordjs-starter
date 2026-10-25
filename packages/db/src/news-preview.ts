import { z } from "zod";
import {
  routeFeedItem,
  type NewsRoutingPreview,
} from "@orbit/core/feed-routing";
import { permissionState } from "@orbit/core/permissions";
import { sourceSetupIssue } from "@orbit/core/module-setup";
import { getGuild, getResource, listResources } from "./store";
const inputSchema = z
  .object({
    sourceId: z.uuid(),
    title: z.string().trim().min(1).max(300),
    summary: z.string().max(1200).default(""),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  })
  .strict();
/** Database reads + pure filter matching only. No URL input, fetching, queue, audit payload or delivery writes. */
export async function previewNewsRouting(
  guildId: string,
  input: unknown
): Promise<NewsRoutingPreview> {
  const data = inputSchema.parse(input),
    guild = await getGuild(guildId),
    source = await getResource(guildId, data.sourceId);
  if (!guild?.installed) throw new Error("Install Orbit in this server first.");
  if (!source || source.guildId !== guildId || source.kind !== "source")
    throw new Error("News source not found in this server.");
  const routes = await listResources(guildId, "route", 101);
  if (routes.length > 100)
    throw new Error(
      "This preview supports up to 100 routing rules. Reduce the number before previewing; no partial routing result was returned."
    );
  const plan = routeFeedItem(source, routes, data, guild.channels),
    blocked: string[] = [];
  if (!guild.config.modules.news)
    blocked.push("News is paused; no delivery would be queued.");
  if (!source.enabled) blocked.push("This source is disabled.");
  const setup = sourceSetupIssue(source);
  if (setup) blocked.push(setup);
  if (source.enabled && !plan.accepted)
    blocked.push("The source keyword filter did not match the sample.");
  if (plan.missingChannels.length)
    blocked.push(
      "One or more matching destinations were deleted, are unsynced, or are not text channels; those destinations are excluded."
    );
  if (!plan.destinations.length)
    blocked.push(
      "No configured direct destination or enabled matching route resolves to a server text channel."
    );
  return {
    sourceName: source.name,
    matched: plan.accepted,
    blocked,
    normalizedTags: plan.normalized.tags,
    fetchPerformed: false,
    sendPerformed: false,
    deliveryVerified: false,
    destinations: plan.destinations.map((d) => {
      const channel = guild.channels.find((c) => c.id === d.channelId)!;
      const role =
        d.settings.notificationRoleId || guild.config.notificationRoleId;
      return {
        channelId: d.channelId,
        channelName: channel.name,
        matchedBy: d.matchedBy,
        permissions: permissionState(channel.permissionBits, [
          "ViewChannel",
          "SendMessages",
          "EmbedLinks",
        ]),
        notificationRole: role
          ? (guild.roles.find((r) => r.id === role)?.name ??
            "Deleted or unsynced role")
          : null,
      };
    }),
  };
}
