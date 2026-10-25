import { gatewayIntentNames } from "@orbit/core/permissions";
import { fingerprint, safeText } from "@orbit/core";
import { isDemo, required, validateEnvironment } from "@orbit/core/environment";
import { assertFreshBotAction } from "@orbit/core/bot-actions";
import { errorDiagnostic } from "@orbit/core/diagnostics";
import { logger } from "@orbit/core/logger";
import { redisConnection } from "@orbit/core/queue";
import {
  audit,
  closeDb,
  getGuild,
  getResource,
  setHealth,
  putMusicState,
  emptyMusic,
} from "@orbit/db";
import { Worker } from "bullmq";
import {
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
} from "discord.js";
import "dotenv/config";
import { executeCommunity, createCommunityRest } from "./community";
import { onMessage } from "./automod";
import { onInteraction } from "./interactions";
import { MusicService } from "./music";
import { handleReaction, publishPanel } from "./roles";
import { claimShopRole } from "./shop";
import { removeGuild, syncGuild } from "./sync";
async function main() {
  if (isDemo()) {
    logger.info(
      "Demo mode: bot login, real messages, moderation, and audio are disabled. Run the web dashboard to explore."
    );
    return;
  }
  validateEnvironment("bot");
  const communityRest = createCommunityRest(required("DISCORD_TOKEN"));
  const client = new Client({
    intents: gatewayIntentNames.map((name) => GatewayIntentBits[name]),
    partials: [
      Partials.Message,
      Partials.Channel,
      Partials.Reaction,
      Partials.User,
    ],
  });
  const music = new MusicService(client);
  let actionWorker: Worker | undefined;
  let heartbeat: NodeJS.Timeout | undefined;
  let syncTimer: NodeJS.Timeout | undefined;
  client.on(
    Events.InteractionCreate,
    (i) => void onInteraction(client, music, i, communityRest)
  );
  client.on(
    Events.MessageCreate,
    (m) =>
      void onMessage(m).catch((e) =>
        logger.error(
          { guildId: m.guildId, error: e.message },
          "Message handling failed"
        )
      )
  );
  client.on(
    Events.MessageReactionAdd,
    (r, u) =>
      void handleReaction(r, u, true).catch((e) =>
        logger.warn({ error: e.message }, "Reaction role failed")
      )
  );
  client.on(
    Events.MessageReactionRemove,
    (r, u) =>
      void handleReaction(r, u, false).catch((e) =>
        logger.warn({ error: e.message }, "Reaction role removal failed")
      )
  );
  client.on(
    Events.GuildCreate,
    (g) =>
      void syncGuild(g).catch((e) =>
        logger.error({ error: e.message }, "Guild sync failed")
      )
  );
  client.on(Events.GuildUpdate, (_before, guild) => {
    void syncGuild(guild).catch((error) =>
      logger.warn(
        { guildId: guild.id, error: errorDiagnostic(error) },
        "Guild metadata sync failed"
      )
    );
  });
  client.on(
    Events.GuildDelete,
    (g) =>
      void removeGuild(g.id).catch((e) =>
        logger.error({ error: e.message }, "Guild removal sync failed")
      )
  );
  for (const event of [
    Events.GuildRoleCreate,
    Events.GuildRoleUpdate,
    Events.GuildRoleDelete,
  ] as const)
    client.on(event, (...args: any[]) => {
      const role = args.at(-1);
      void syncGuild(role.guild).catch((e) =>
        logger.warn({ error: e.message }, "Role sync failed")
      );
    });
  for (const event of [
    Events.ChannelCreate,
    Events.ChannelUpdate,
    Events.ChannelDelete,
  ] as const)
    client.on(event, (...args: any[]) => {
      const channel = args.at(-1);
      if (channel.guild)
        void syncGuild(channel.guild).catch((e) =>
          logger.warn({ error: e.message }, "Channel sync failed")
        );
    });
  client.on(Events.GuildMemberUpdate, (_before, member) => {
    if (member.id === client.user?.id)
      void syncGuild(member.guild).catch((error) =>
        logger.warn(
          { guildId: member.guild.id, error: errorDiagnostic(error) },
          "Bot role-membership permission sync failed"
        )
      );
  });
  client.on(Events.ShardDisconnect, (close) => {
    if (close.code === 4014) {
      logger.fatal(
        "Privileged intents are disabled. Enable Server Members and Message Content in the Discord Developer Portal."
      );
      process.exitCode = 1;
      void shutdown();
    }
  });
  client.once(Events.ClientReady, () => {
    void (async () => {
      logger.info(
        { userId: client.user!.id, guilds: client.guilds.cache.size },
        "Discord gateway connected; initializing bot services"
      );
      if (client.user!.id !== required("DISCORD_CLIENT_ID"))
        throw new Error(
          "DISCORD_CLIENT_ID does not match the logged-in bot. Use the application ID belonging to DISCORD_TOKEN, then register commands in that application."
        );
      for (const guild of client.guilds.cache.values()) {
        await syncGuild(guild).catch((error) =>
          logger.warn(
            { guildId: guild.id, error: errorDiagnostic(error) },
            "Initial guild sync failed; scheduled sync will retry"
          )
        );
        await putMusicState(guild.id, emptyMusic());
      }
      const beat = async () => {
        await setHealth(
          "Discord API",
          client.isReady() ? "healthy" : "offline",
          Math.max(0, client.ws.ping),
          client.isReady()
            ? "Discord.js gateway connected"
            : "Discord gateway disconnected; commands cannot be acknowledged"
        );
        await music.heartbeat();
      };
      await beat();
      heartbeat = setInterval(
        () =>
          void beat().catch((e) =>
            logger.warn({ error: e.message }, "Bot heartbeat failed")
          ),
        30000
      );
      syncTimer = setInterval(() => {
        for (const g of client.guilds.cache.values())
          void syncGuild(g).catch((e) =>
            logger.warn({ error: e.message }, "Scheduled guild sync failed")
          );
      }, 300000);
      actionWorker = new Worker(
        "discord-actions",
        async (job) => {
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
              throw new Error(
                "The requester no longer has Manage Server permission"
              );

            if (job.name === "publish-panel")
              return await publishPanel(
                client,
                guildId,
                job.data.panelId,
                actorId
              );
            if (job.name === "claim-role")
              return await claimShopRole(actor, job.data.itemId);
            if (job.name === "music")
              return await music.action(actor, job.data);
            if (job.name === "test-message") {
              const stored = await getGuild(guildId),
                source = await getResource(guildId, job.data.sourceId);
              if (
                !stored?.config.modules.news ||
                !source ||
                source.kind !== "source"
              )
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
                    .setTitle(
                      `A little test flight from ${safeText(source.name, 80)}`
                    )
                    .setDescription(
                      "Your community updates have found their way. This is a test message from Orbit."
                    )
                    .setColor(
                      parseInt(source.data.embedColor.replace("#", ""), 16)
                    )
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
        },
        { connection: redisConnection(), concurrency: 5 }
      );
      actionWorker.on("failed", (job, error) => {
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
            },
            "failed",
            job.name,
            errorDiagnostic(error)
          ).catch(() => {});
      });
      actionWorker.on("error", (e) =>
        logger.error({ error: e.message }, "Bot action queue error")
      );
      await actionWorker.waitUntilReady();
      logger.info(
        {
          userId: client.user!.id,
          guilds: client.guilds.cache.size,
          actionQueue: "discord-actions",
        },
        "Orbit is ready; dashboard action consumer is listening"
      );
    })().catch((e) => {
      logger.fatal({ error: e.message }, "Bot startup failed");
      process.exitCode = 1;
      void shutdown();
    });
  });
  let stopping = false;
  async function shutdown() {
    if (stopping) return;
    stopping = true;
    if (heartbeat) clearInterval(heartbeat);
    if (syncTimer) clearInterval(syncTimer);
    await actionWorker?.close();
    await music.shutdown();
    await setHealth("Discord API", "offline", 0, "Bot shut down").catch(
      () => {}
    );
    client.destroy();
    await redisConnection().quit();
    await closeDb();
  }
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
  await client.login(required("DISCORD_TOKEN"));
}
main().catch((e) => {
  logger.fatal({ error: e.message }, "Bot failed");
  process.exit(1);
});
