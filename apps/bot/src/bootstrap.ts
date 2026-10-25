import {
  Client,
  Events,
  GatewayCloseCodes,
  GatewayIntentBits,
  Partials,
} from "discord.js";
import type { Worker } from "bullmq";
import { gatewayIntentNames } from "@orbit/core/permissions";
import { isDemo, required, validateEnvironment } from "@orbit/core/environment";
import { errorDiagnostic } from "@orbit/core/diagnostics";
import { logger } from "@orbit/core/logger";
import { closeRedisConnection } from "@orbit/core/queue";
import { closeDb, setHealth } from "@orbit/db";
import { createCommunityRest } from "./features/community";
import { MusicService } from "./features/music/service";
import { attachGatewayEvents } from "./events/gateway";
import { createActionConsumer } from "./infrastructure/action-consumer";
import { startMaintenance } from "./infrastructure/maintenance";

export async function startBot() {
  if (isDemo()) {
    logger.info(
      "Demo mode: bot login, real messages, moderation, and audio are disabled. Run the web dashboard to explore."
    );
    return;
  }
  validateEnvironment("bot");
  const client = new Client({
    intents: gatewayIntentNames.map((name) => GatewayIntentBits[name]),
    partials: [
      Partials.Message,
      Partials.Channel,
      Partials.Reaction,
      Partials.User,
    ],
  });
  const rest = createCommunityRest(required("DISCORD_TOKEN"));
  const music = new MusicService(client);
  const abort = new AbortController();
  const detach = attachGatewayEvents(client, music, rest);
  let worker: Worker | undefined;
  let consumerStarted = false;
  let stopMaintenance: Awaited<ReturnType<typeof startMaintenance>>;
  let initialization: Promise<void> = Promise.resolve();
  let resolveReady!: () => void;
  let rejectReady!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // Entrypoints need not await this observer: initialization still logs/fails
  // through its owner, and stopping before ClientReady is an expected rejection.
  void ready.catch(() => {});
  let stopping: Promise<void> | undefined;

  async function initialize() {
    logger.info(
      { userId: client.user!.id, guilds: client.guilds.cache.size },
      "Discord gateway connected; initializing bot services"
    );
    if (client.user!.id !== required("DISCORD_CLIENT_ID"))
      throw new Error(
        "DISCORD_CLIENT_ID does not match the logged-in bot. Use the application ID belonging to DISCORD_TOKEN, then register commands in that application."
      );
    stopMaintenance = await startMaintenance(client, music, abort.signal);
    if (abort.signal.aborted) return;
    worker = createActionConsumer(client, music, rest);
    // A shutdown must not wait forever for an unavailable Redis connection.
    // autorun is false: there are no active jobs to force-close before this gate.
    let onAbort!: () => void;
    const interrupted = new Promise<void>((resolve) => {
      onAbort = resolve;
      abort.signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      await Promise.race([worker.waitUntilReady(), interrupted]);
    } finally {
      abort.signal.removeEventListener("abort", onAbort);
    }
    if (abort.signal.aborted) return;
    consumerStarted = true;
    void worker.run().catch((error) => {
      if (!abort.signal.aborted) fail(error);
    });
    logger.info(
      {
        userId: client.user!.id,
        guilds: client.guilds.cache.size,
        actionQueue: "discord-actions",
      },
      "Orbit is ready; dashboard action consumer is listening"
    );
  }
  function fail(error: unknown) {
    logger.fatal(
      { error: errorDiagnostic(error) },
      "Bot startup/runtime failed"
    );
    process.exitCode = 1;
    void stop();
  }
  function onReady() {
    initialization = initialize();
    void initialization.then(resolveReady, (error) => {
      rejectReady(error);
      if (!abort.signal.aborted) fail(error);
    });
  }
  function onDisconnect(close: { code: number }) {
    if (close.code !== GatewayCloseCodes.DisallowedIntents) return;
    logger.fatal(
      "Privileged intents are disabled. Enable Server Members and Message Content in the Discord Developer Portal."
    );
    process.exitCode = 1;
    void stop();
  }
  const onSignal = () => {
    void stop();
  };
  function stop(): Promise<void> {
    if (stopping) return stopping;
    rejectReady(new Error("Bot stopped before readiness completed."));
    abort.abort();
    detach();
    client.off(Events.ClientReady, onReady);
    client.off(Events.ShardDisconnect, onDisconnect);
    process.off("SIGTERM", onSignal);
    process.off("SIGINT", onSignal);
    stopping = (async () => {
      // Initialization checks abort after every stage before allocating more work.
      await initialization.catch(() => {});
      const cleanup = [
        ["action consumer", () => worker?.close(!consumerStarted)],
        ["maintenance", () => stopMaintenance?.()],
        ["music", () => music.shutdown()],
        ["gateway", () => client.destroy()],
        [
          "publication REST",
          () => {
            rest.clearHashSweeper();
            rest.clearHandlerSweeper();
          },
        ],
        [
          "gateway health",
          () => setHealth("Discord API", "offline", 0, "Bot shut down"),
        ],
        ["Redis", () => closeRedisConnection()],
        ["database", () => closeDb()],
      ] as const;
      for (const [resource, close] of cleanup) {
        try {
          await close();
        } catch (error) {
          process.exitCode = 1;
          logger.error(
            { resource, error: errorDiagnostic(error) },
            "Bot shutdown cleanup failed; continuing remaining cleanup"
          );
        }
      }
    })();
    return stopping;
  }
  client.once(Events.ClientReady, onReady);
  client.on(Events.ShardDisconnect, onDisconnect);
  process.once("SIGTERM", onSignal);
  process.once("SIGINT", onSignal);
  try {
    await client.login(required("DISCORD_TOKEN"));
  } catch (error) {
    if (!abort.signal.aborted) {
      await stop();
      throw error;
    }
  }
  return { stop, ready };
}
