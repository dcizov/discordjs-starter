import { reconcileCommunityPosts } from "./community";
import type { Resource } from "@orbit/core";
import { fingerprint, safeText } from "@orbit/core";
import { isDemo, required, validateEnvironment } from "@orbit/core/environment";
import { pollDeals, pollSource } from "@orbit/core/feeds";
import { logger } from "@orbit/core/logger";
import { assertDeliverableDeal } from "@orbit/core/deal-policy";
import { dealEmbed, dealLinkRow } from "@orbit/core/deal-presentation";
import { feedEmbed } from "@orbit/core/news-presentation";
import type { GameDeal } from "@orbit/core/deal-types";
import {
  createQueue,
  redisConnection,
  closeRedisConnection,
} from "@orbit/core/queue";
import {
  closeDb,
  database,
  dispatchItems,
  getGuild,
  getResource,
  listInstalledGuilds,
  listResources,
  schema,
  setHealth,
} from "@orbit/db";
import { Worker, type Job } from "bullmq";
import { REST, Routes } from "discord.js";
import "dotenv/config";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
async function main() {
  if (isDemo()) {
    logger.info(
      "Demo mode: live feed polling, external integrations, and deliveries are disabled."
    );
    return;
  }
  validateEnvironment("worker");
  const queue = createQueue("community-jobs");
  const actionQueue = createQueue("discord-actions");
  const rest = new REST({ version: "10", timeout: 15000, retries: 3 }).setToken(
    required("DISCORD_TOKEN")
  );
  async function updateSourceHealth(
    source: Resource,
    healthy: boolean,
    error = ""
  ) {
    await database()
      .db.update(schema.resources)
      .set({
        data: sql`${schema.resources.data} || ${JSON.stringify({ health: healthy ? "healthy" : "degraded", lastChecked: new Date().toISOString(), lastError: error })}::jsonb`,
      })
      .where(
        and(
          eq(schema.resources.guildId, source.guildId),
          eq(schema.resources.id, source.id)
        )
      );
  }
  async function poll(job: Job) {
    const source = await getResource(job.data.guildId, job.data.resourceId);
    if (!source || !source.enabled || !["source", "deal"].includes(source.kind))
      return;
    const guild = await getGuild(source.guildId);
    if (
      !guild?.installed ||
      !guild.config.modules[source.kind === "source" ? "news" : "deals"]
    )
      return;
    if (source.kind === "source" && source.data.adapter === "webhook") return;
    if (
      source.kind === "source" &&
      source.data.adapter !== "steam" &&
      !source.data.url
    ) {
      await database()
        .db.update(schema.resources)
        .set({
          data: sql`${schema.resources.data} || '{"health":"setup_required"}'::jsonb`,
        })
        .where(
          and(
            eq(schema.resources.id, source.id),
            eq(schema.resources.guildId, source.guildId)
          )
        );
      return;
    }
    try {
      let items =
        source.kind === "deal"
          ? await pollDeals(source)
          : await pollSource(source);
      items = items.filter(
        (i) => Date.now() - new Date(i.publishedAt).getTime() < 7 * 86400000
      );
      if (!source.data.lastChecked && source.kind === "source")
        items = items.slice(0, 3);
      const count = await dispatchItems(source, items);
      await updateSourceHealth(source, true);
      logger.info(
        { guildId: source.guildId, sourceId: source.id, queued: count },
        "Source checked"
      );
    } catch (e: any) {
      await updateSourceHealth(source, false, safeText(e.message, 300));
      throw e;
    }
  }
  async function deliver(job: Job) {
    const result = await database().db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${job.data.deliveryId}, 1))`
      );
      const [row] = await tx
        .select()
        .from(schema.deliveries)
        .where(eq(schema.deliveries.id, job.data.deliveryId))
        .for("update");
      if (!row || row.status === "delivered") return {};
      const [guild] = await tx
        .select()
        .from(schema.guilds)
        .where(eq(schema.guilds.id, row.guildId));
      const [source] = await tx
        .select()
        .from(schema.resources)
        .where(
          and(
            eq(schema.resources.id, row.sourceId),
            eq(schema.resources.guildId, row.guildId)
          )
        );
      if (
        !guild?.installed ||
        !source?.enabled ||
        !guild.config.modules[source.kind === "deal" ? "deals" : "news"]
      ) {
        await tx
          .update(schema.deliveries)
          .set({
            status: "failed",
            error: "Source removed, paused, or module disabled",
          })
          .where(eq(schema.deliveries.id, row.id));
        return {};
      }
      await tx
        .update(schema.deliveries)
        .set({ status: "sending", attempts: row.attempts + 1 })
        .where(eq(schema.deliveries.id, row.id));
      try {
        const channel = guild.channels.find(
          (c) => c.id === row.channelId && c.type === "text"
        );
        if (!channel?.canSend)
          throw new Error(
            "Missing destination channel or Send Messages / Embed Links permissions"
          );
        const payload = row.payload ?? {};
        const roleId = guild.roles.some(
          (r) =>
            r.id === payload.notificationRoleId &&
            !r.managed &&
            r.id !== guild.id
        )
          ? payload.notificationRoleId
          : null;
        const deal =
          source.kind === "deal"
            ? (payload.deal as GameDeal | undefined)
            : undefined;
        if (source.kind === "deal") {
          if (source.data.channelId !== row.channelId)
            throw new Error(
              "The deal destination changed; this old channel delivery was cancelled."
            );
          assertDeliverableDeal(deal, source.data);
        }
        // One shared presentation policy produces the preview cards and this
        // embed, so a dashboard preview cannot promise different formatting.
        const embed = deal
          ? dealEmbed(deal)
          : feedEmbed(
              {
                id: row.externalId,
                title: row.title,
                url: row.url,
                summary: payload.summary ?? "",
                image: payload.image ?? null,
                attribution: payload.attribution ?? "unknown",
                publishedAt: payload.publishedAt ?? "",
                tags: payload.tags ?? [],
                sourceLabel: payload.sourceName ?? source.name,
              },
              {
                includeSummary: payload.includeSummary,
                color: payload.color,
                sourceName: payload.sourceName ?? source.name,
              }
            );
        await rest.post(Routes.channelMessages(row.channelId), {
          body: {
            content: roleId ? `<@&${roleId}>` : "",
            embeds: [embed],
            ...(deal
              ? {
                  components: (() => {
                    const row = dealLinkRow(deal);
                    return row ? [row] : [];
                  })(),
                }
              : {}),
            allowed_mentions: {
              parse: [],
              roles: roleId ? [roleId] : [],
              users: [],
              replied_user: false,
            },
            nonce: fingerprint(
              row.guildId,
              row.sourceId,
              `${row.externalId}:${row.channelId}`
            ).slice(0, 24),
            enforce_nonce: true,
          },
        });
        await tx
          .update(schema.deliveries)
          .set({ status: "delivered", error: null, deliveredAt: new Date() })
          .where(eq(schema.deliveries.id, row.id));
        await tx.insert(schema.auditLogs).values({
          guildId: row.guildId,
          actorId: "orbit-worker",
          actorName: "Orbit",
          action: "delivered",
          target: source.name,
          detail: `Delivered ${safeText(row.title, 100)} to #${channel.name}`,
        });
        return {};
      } catch (e: any) {
        await tx
          .update(schema.deliveries)
          .set({
            status:
              job.attemptsMade + 1 >= (job.opts.attempts ?? 5)
                ? "failed"
                : "pending",
            error: safeText(e.message, 500),
          })
          .where(eq(schema.deliveries.id, row.id));
        return { error: safeText(e.message, 500) };
      }
    });
    if (result.error) throw new Error(result.error);
  }
  const worker = new Worker(
    "community-jobs",
    async (job) => {
      if (job.name === "poll") return poll(job);
      if (job.name === "deliver") return deliver(job);
      throw new Error("Unknown community job");
    },
    {
      connection: redisConnection(),
      concurrency: 5,
      limiter: { max: 20, duration: 1000 },
      settings: {
        backoffStrategy: (attempts, type, error) =>
          type === "provider"
            ? Math.max(
                Number((error as any).retryAfterMs) || 0,
                Math.min(3600000, 10000 * 2 ** (attempts - 1))
              )
            : 3000,
      },
    }
  );
  worker.on("failed", (job, e) =>
    logger.warn(
      { jobId: job?.id, error: e.message, attempt: job?.attemptsMade },
      "Community job failed; retry policy applies"
    )
  );
  worker.on("error", (e) =>
    logger.error({ error: e.message }, "Worker queue error")
  );
  let reconciling = false;
  async function reconcile() {
    if (reconciling) return;
    reconciling = true;
    try {
      const queuedAnnouncements = await reconcileCommunityPosts(actionQueue);
      const active = new Set<string>();
      const guilds = await listInstalledGuilds();
      for (const guild of guilds) {
        if (!guild.installed) continue;
        const resources = await listResources(guild.id);
        for (const source of resources) {
          if (
            !source.enabled ||
            !["source", "deal"].includes(source.kind) ||
            !guild.config.modules[source.kind === "deal" ? "deals" : "news"] ||
            source.data.adapter === "webhook"
          )
            continue;
          const id = `poll-${source.id}`;
          active.add(id);
          await queue.upsertJobScheduler(
            id,
            {
              every:
                Math.max(
                  source.kind === "deal" ? 15 : 5,
                  source.data.intervalMinutes ?? 30
                ) * 60000,
            },
            {
              name: "poll",
              data: { guildId: guild.id, resourceId: source.id },
              opts: {
                attempts: 5,
                backoff: { type: "provider", delay: 10000 },
              },
            }
          );
        }
      }
      const schedulers = await queue.getJobSchedulers(0, 10000, true);
      for (const scheduler of schedulers)
        if (scheduler.key.startsWith("poll-") && !active.has(scheduler.key))
          await queue.removeJobScheduler(scheduler.key);
      // Transactional outbox recovery: a Redis outage between DB insert and enqueue cannot lose an event.
      const pending = await database()
        .db.select({ id: schema.deliveries.id })
        .from(schema.deliveries)
        .where(
          and(
            inArray(schema.deliveries.status, ["pending", "sending"]),
            lt(schema.deliveries.createdAt, new Date(Date.now() - 60000))
          )
        )
        .limit(500);
      for (const row of pending)
        await queue.add(
          "deliver",
          { deliveryId: row.id },
          { jobId: `delivery-${row.id}` }
        );
      await database()
        .db.delete(schema.sessions)
        .where(lt(schema.sessions.expiresAt, new Date()));
      await setHealth(
        "Background workers",
        "healthy",
        0,
        `${active.size} scheduled source checks; ${queuedAnnouncements} announcement requests queued (delivery not confirmed)`
      );
    } finally {
      reconciling = false;
    }
  }
  await reconcile();
  const timer = setInterval(
    () =>
      void reconcile().catch((e) =>
        logger.error({ error: e.message }, "Schedule reconciliation failed")
      ),
    60000
  );
  logger.info("Orbit workers are ready");
  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    await worker.close();
    await queue.close();
    await actionQueue.close();
    await setHealth(
      "Background workers",
      "offline",
      0,
      "Workers shut down"
    ).catch(() => {});
    await closeRedisConnection();
    await closeDb();
  }
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
}
main().catch((e) => {
  logger.fatal({ error: e.message }, "Worker startup failed");
  process.exit(1);
});
