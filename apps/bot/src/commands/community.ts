import type { CommandContext } from "./context";
import {
  communityModule,
  communityDate,
  communityIdSchema,
} from "@orbit/core/community";
import {
  listCommunityPosts,
  getCommunityPost,
  scheduleCommunityPost,
  cancelCommunityPost,
} from "@orbit/db";
import { PermissionFlagsBits, type Client, type REST } from "discord.js";
import { executeCommunity } from "../features/community";
export async function communityCommand(
  context: CommandContext,
  client: Client,
  communityRest?: Pick<REST, "get" | "post">
) {
  const { i, guild, member, config, reply } = context;

  await guild.fetch(); // Refresh ownership before trusting manager permissions.
  await guild.roles.fetch();
  if (!member.permissions.has(PermissionFlagsBits.ManageGuild))
    throw new Error("Manage Server is required for community publishing.");
  const kind = i.commandName === "poll" ? "poll" : "announcement";
  const action = i.options.getSubcommand();
  if (action === "list") {
    const page = await listCommunityPosts(guild.id, { kind, pageSize: 10 });
    await reply({
      title: kind === "poll" ? "Native polls" : "Announcements",
      description: page.items.length
        ? page.items
            .map(
              (p) =>
                `• ${p.title} — ${p.state}${p.scheduledFor ? ` · ${communityDate(p.scheduledFor, config.timezone)} (${config.timezone})` : ""}`
            )
            .join("\n")
        : "No saved posts. Create a draft in the Orbit dashboard. Nothing is sent by listing posts.",
      footer:
        "Private manager view · autocomplete selects stored posts · use the dashboard for older records",
    });
    return;
  }
  const id = communityIdSchema.parse(i.options.getString("post", true));
  const post = await getCommunityPost(guild.id, id);
  if (!post || post.kind !== kind)
    throw new Error("Post not found in this server.");
  if (action === "schedule") {
    const saved = await scheduleCommunityPost(
      guild.id,
      id,
      post.version,
      member.id,
      i.options.getString("utc", true)
    );
    await reply(
      `Scheduled for ${communityDate(saved.scheduledFor, config.timezone)} (${config.timezone}); UTC ${saved.scheduledFor}. Delivery is not yet confirmed. Workers send only within a 15-minute grace window.`
    );
    return;
  }
  if (action === "cancel") {
    await cancelCommunityPost(guild.id, id, post.version, member.id);
    await reply("Schedule/draft cancelled. No Discord message was recalled.");
    return;
  }
  if (!["publish", "refresh", "close"].includes(action))
    throw new Error("Unsupported action.");
  if (action === "publish" && !config.modules[communityModule(kind)])
    throw new Error("This module is paused.");
  if (!communityRest)
    throw new Error(
      "Community publishing transport is unavailable. No message was sent."
    );
  const result = await executeCommunity(client, communityRest, {
    guildId: guild.id,
    id,
    version: post.version,
    actorId: member.id,
    action: action as "publish" | "refresh" | "close",
    requestedAt: i.createdTimestamp,
  });
  await reply({
    title: kind === "poll" ? "Native poll updated" : "Announcement published",
    description: `Recorded state: ${result.state}.${result.messageId ? ` https://discord.com/channels/${guild.id}/${post.channelId}/${result.messageId}` : ""}${action === "refresh" ? " Results remain approximate until Discord finalizes them; unavailable counts are not zero. View the aggregate breakdown in the dashboard." : ""}`,
  });
  return;
}
