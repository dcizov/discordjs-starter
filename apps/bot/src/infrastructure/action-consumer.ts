import { Worker, type Job } from "bullmq";
import {
  EmbedBuilder,
  PermissionFlagsBits,
  type Client,
  type REST,
} from "discord.js";
import { fingerprint, safeText } from "@orbit/core";
import { assertFreshBotAction } from "@orbit/core/bot-actions";
import { errorDiagnostic } from "@orbit/core/diagnostics";
import { logger } from "@orbit/core/logger";
import { redisConnection } from "@orbit/core/queue";
import { audit, getGuild, getResource } from "@orbit/db";
import { executeCommunity } from "../features/community";
import type { MusicService } from "../features/music/service";
import { publishPanel } from "../features/roles/panels";
import { claimShopRole } from "../features/roles/shop";
import { applyTemplateRun, captureTemplate } from "../features/templates/apply";
import { syncRoster } from "./roster-sync";

export async function executeDashboardAction(
  client: Client,
  music: MusicService,
  communityRest: Pick<REST, "get" | "post">,
  job: Pick<Job, "name" | "data" | "timestamp" | "id">
) {
  try {
    if (!client.isReady())
      throw new Error(
        "The Discord gateway is reconnecting. No action was executed; retry when the bot is ready."
      );
    assertFreshBotAction(job.name, job.timestamp);
    if (job.name === "community")
      return await executeCommunity(client, communityRest, {
        ...job.data,
        requestedAt: job.timestamp,
      });
    const { guildId, actorId } = job.data;
    const guild = await client.guilds.fetch(guildId),
      actor = await guild.members.fetch({ user: actorId, force: true });
    if (
      job.name !== "music" &&
      job.name !== "claim-role" &&
      !actor.permissions.has(PermissionFlagsBits.ManageGuild)
    )
      throw new Error("The requester no longer has Manage Server permission");

    if (job.name === "publish-panel")
      return await publishPanel(client, guildId, job.data.panelId, actorId);
    if (job.name === "claim-role")
      return await claimShopRole(actor, job.data.itemId);
    if (job.name === "music") return await music.action(actor, job.data);
    if (job.name === "capture-template")
      return await captureTemplate(guild, {
        name: String(job.data.name ?? "Untitled template"),
        description: String(job.data.description ?? ""),
        include: {
          structure: job.data.include?.structure !== false,
          config: job.data.include?.config !== false,
        },
        actorId,
      });
    if (job.name === "apply-template")
      return await applyTemplateRun(guild, {
        templateId: String(job.data.templateId),
        runId: String(job.data.runId),
        fingerprint: String(job.data.fingerprint),
        mapping: job.data.mapping,
      });
    if (job.name === "sync-roster") return await syncRoster(guild, "manual");
    if (job.name === "test-message") {
      const stored = await getGuild(guildId),
        source = await getResource(guildId, job.data.sourceId);
      if (!stored?.config.modules.news || !source || source.kind !== "source")
        throw new Error("Source unavailable or news paused");
      const channel = await guild.channels.fetch(source.data.channelId),
        me = await guild.members.fetchMe();
      if (
        !channel?.isTextBased() ||
        !("send" in channel) ||
        !channel
          .permissionsFor(me)
          ?.has([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
          ])
      )
        throw new Error("Missing permissions to send a test message");
      const message = await channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle(`A little test flight from ${safeText(source.name, 80)}`)
            .setDescription(
              "Your community updates have found their way. This is a test message from Orbit."
            )
            .setColor(parseInt(source.data.embedColor.replace("#", ""), 16))
            .setTimestamp(),
        ],
        allowedMentions: { parse: [] },
        nonce: fingerprint(guildId, source.id, job.id!).slice(0, 24),
        enforceNonce: true,
      });
      return { messageId: message.id };
    }
    throw new Error("Unknown bot action");
  } catch (error) {
    // BullMQ persists failedReason: sanitize it before it reaches Redis or an API response.
    throw new Error(errorDiagnostic(error));
  }
}
export function createActionConsumer(
  client: Client,
  music: MusicService,
  communityRest: Pick<REST, "get" | "post">
) {
  const worker = new Worker(
    "discord-actions",
    (job) => executeDashboardAction(client, music, communityRest, job),
    { connection: redisConnection(), concurrency: 5, autorun: false }
  );
  worker.on("failed", (job, error) => {
    logger.warn(
      { jobId: job?.id, error: errorDiagnostic(error) },
      "Dashboard bot action failed"
    );
    if (job)
      void audit(
        job.data.guildId,
        {
          id: job.data.actorId,
          name:
            client.users.cache.get(job.data.actorId)?.displayName ??
            job.data.actorId,
          avatar: client.users.cache.get(job.data.actorId)?.avatar ?? null,
        },
        "failed",
        job.name,
        errorDiagnostic(error)
      ).catch((error) =>
        logger.warn(
          { error: errorDiagnostic(error) },
          "Could not save dashboard action failure"
        )
      );
  });
  worker.on("error", (e) =>
    logger.error({ error: errorDiagnostic(e) }, "Bot action queue error")
  );
  return worker;
}
