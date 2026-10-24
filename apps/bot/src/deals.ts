import { dealSchema } from "@orbit/core/config";
import {
  dealCountryCurrencies,
  gameDealInfo,
  pollDeals,
  searchGameDeals,
} from "@orbit/core/deals";
import { dealQuality } from "@orbit/core/deal-policy";
import { getGuild, listResources, saveResource } from "@orbit/db";
import {
  ChannelType,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type GuildMember,
} from "discord.js";
import type { Resource } from "@orbit/core";
import { gameDealReply } from "./deal-replies";
import { commandReply, replyLabel } from "./replies";

export async function handleDeals(
  i: ChatInputCommandInteraction,
  member: GuildMember
) {
  const guild = member.guild,
    actor = { id: member.id, name: member.displayName };
  const stored = await getGuild(guild.id);
  if (!stored?.config.modules.deals) throw new Error("Game deals are paused.");
  const sub = i.options.getSubcommand(),
    country = i.options.getString("country") ?? "DE";
  const reply = (description: string) =>
    i.editReply(commandReply("deals", { description }));
  if (sub === "search") {
    const results = await searchGameDeals(
      i.options.getString("query", true),
      country,
      i.options.getInteger("results") ?? 3
    );
    await (results.length
      ? i.editReply(gameDealReply(results))
      : reply(
          "No matching non-mature base games found. Try another title. DLC/bundles are not included."
        ));
    return;
  }
  if (sub === "info") {
    await i.editReply(
      gameDealReply(
        [await gameDealInfo(i.options.getString("game", true), country)],
        true
      )
    );
    return;
  }
  const resources = await listResources(guild.id, "deal");
  const feeds = resources.filter(
    (resource) => resource.guildId === guild.id && !resource.data.gameId
  );
  if (sub === "list") {
    await reply(
      feeds.length
        ? feeds
            .slice(0, 8)
            .map((feed) => {
              const quality = dealQuality(feed.data);
              return `**${replyLabel(feed.name, 50)}** · ${feed.enabled ? "enabled" : "paused"}\n<#${feed.data.channelId}> · ${feed.data.region}/${feed.data.currency} · every ${feed.data.intervalMinutes} min\nTop ${quality.maxPopularityRank} ITAD · ≥${quality.minReviews.toLocaleString("en-US")} Steam reviews · ≥${quality.minScore}% · ≤${quality.maxPostsPerCheck} new posts/check`;
            })
            .join("\n\n")
        : "No automatic deal feed is configured. A manager can use `/deals feed` or add a general deal subscription in the dashboard."
    );
    return;
  }
  if (sub === "now") {
    const configured = feeds.find((feed) => feed.enabled);
    const data = dealSchema.parse({
      name: "Popular deal preview",
      data: {
        region: country,
        currency: dealCountryCurrencies[country],
        ...(!i.options.getString("country") ? configured?.data : {}),
      },
    });
    const source: Resource = {
      id: "read-only-preview",
      guildId: guild.id,
      kind: "deal",
      ...data,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const items = await pollDeals(source);
    const results = items
      .flatMap((item) => (item.deal ? [item.deal] : []))
      .slice(0, 3);
    await (results.length
      ? i.editReply(gameDealReply(results))
      : reply(
          "No current offers passed the popularity, Steam review/score, price, region and non-mature filters. No lesser-known fallback or channel message was sent."
        ));
    return;
  }
  if (!["feed", "pause", "watch"].includes(sub))
    throw new Error(
      "Unknown deals subcommand. Register the updated command definitions."
    );
  if (!member.permissions.has(PermissionFlagsBits.ManageGuild))
    throw new Error(
      "Manage Server is required to configure or pause shared deal alerts."
    );
  const selected = i.options.getChannel("channel", true);
  const channel = await guild.channels.fetch(selected.id);
  if (
    !channel ||
    ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(
      channel.type
    ) ||
    !("guild" in channel) ||
    channel.guild.id !== guild.id
  )
    throw new Error("Choose a text/announcement channel in this server.");
  const existing = feeds.filter((feed) => feed.data.channelId === channel.id);
  if (sub === "pause") {
    for (const feed of existing.filter((feed) => feed.enabled))
      await saveResource(
        guild.id,
        "deal",
        { name: feed.name, enabled: false, data: feed.data },
        actor,
        feed.id
      );
    await reply(
      existing.length
        ? `Automatic deal posting paused in <#${channel.id}>. Configuration/history are preserved; specific game watches are separate.`
        : "No automatic feed is configured in that channel."
    );
    return;
  }
  const me = await guild.members.fetchMe();
  if (
    !channel
      .permissionsFor(me)
      ?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
      ])
  )
    throw new Error(
      "Orbit needs View Channel, Send Messages and Embed Links in the deals destination."
    );
  if (sub === "watch") {
    const id = i.options.getString("game", true),
      details = await gameDealInfo(id, country);
    await saveResource(
      guild.id,
      "deal",
      {
        name: details.game.title.slice(0, 80),
        enabled: true,
        data: {
          gameId: id,
          channelId: channel.id,
          region: country,
          currency: dealCountryCurrencies[country],
          minDiscount: 20,
        },
      },
      actor
    );
    await reply(
      `Watchlist saved for **${replyLabel(details.game.title, 100)}** in <#${channel.id}>. The delivery worker will check it; this is not a delivery confirmation. Refine price/store filters in the dashboard.`
    );
    return;
  }
  if (existing.filter((feed) => feed.enabled).length > 1)
    throw new Error(
      "Multiple general feeds already target this channel. Pause the duplicates in the dashboard before reconfiguring one."
    );
  const current = existing.find((feed) => feed.enabled) ?? existing[0];
  const feedCountry =
    i.options.getString("country") ?? current?.data.region ?? "DE";
  const data = {
    ...current?.data,
    gameId: "",
    channelId: channel.id,
    region: feedCountry,
    currency: i.options.getString("country")
      ? dealCountryCurrencies[feedCountry]
      : (current?.data.currency ?? dealCountryCurrencies[feedCountry]),
  };
  const options: Record<string, string> = {
    "min-discount": "minDiscount",
    "max-price": "maxPrice",
    "min-reviews": "minReviews",
    "min-score": "minScore",
    "min-players": "minPlayers",
    "popular-rank": "maxPopularityRank",
    interval: "intervalMinutes",
    "max-posts": "maxPostsPerCheck",
  };
  for (const [option, field] of Object.entries(options)) {
    const value =
      option === "max-price"
        ? i.options.getNumber(option)
        : i.options.getInteger(option);
    if (value != null) (data as Record<string, any>)[field] = value;
  }
  const saved = await saveResource(
    guild.id,
    "deal",
    {
      name: current?.name ?? `Popular games · #${channel.name}`.slice(0, 80),
      enabled: true,
      data,
    },
    actor,
    current?.id
  );
  const quality = dealQuality(saved.data);
  await reply(
    `Automatic deal feed ${current ? "updated" : "configured"} in <#${channel.id}>.\nTop ${quality.maxPopularityRank} on ITAD, ≥${quality.minReviews.toLocaleString("en-US")} Steam reviews, ≥${quality.minScore}% positive. Up to ${quality.maxPostsPerCheck} new offers/check.\nThe worker reconciles schedules every minute. No immediate channel post is claimed; use \`/deals now\` for an ephemeral preview. ${process.env.ITAD_API_KEY ? "" : "Setup required: configure ITAD_API_KEY server-side."}`
  );
}
