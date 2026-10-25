import { Queue } from "bullmq";
import IORedis from "ioredis";
import { BotActionUnavailableError } from "./bot-actions";
import { isDemo, required } from "./environment";
let redis: IORedis | undefined;
export function redisConnection() {
  if (isDemo()) throw new Error("Live job queues are disabled in demo mode");
  return (redis ??= new IORedis(required("REDIS_URL"), {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  }));
}
/** Shutdown must never create a connection merely to close it. */
export async function closeRedisConnection() {
  const connection = redis;
  redis = undefined;
  if (!connection) return;
  if (connection.status === "ready") await connection.quit();
  else connection.disconnect();
}
export function createQueue(name: string) {
  return new Queue(name, {
    connection: redisConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 3000 },
      removeOnComplete: { age: 86400, count: 5000 },
      removeOnFail: { age: 604800, count: 5000 },
    },
  });
}
/** Shared bounded admission check for dashboard requests and durable announcement reconciliation. */
export async function assertBotActionConsumer(
  queue: Pick<Queue, "getWorkersCount">
) {
  // Read the actual BullMQ consumer connections, not a stale dashboard heartbeat.
  // A healthy Lavalink/web container cannot consume these Discord gateway jobs.
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const workers = await Promise.race([
      queue.getWorkersCount(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new BotActionUnavailableError(
                "Cannot reach the bot action queue. Check Redis and start the bot service; no action was queued."
              )
            ),
          3000
        );
      }),
    ]);
    if (workers < 1) throw new BotActionUnavailableError();
  } catch (error) {
    if (error instanceof BotActionUnavailableError) throw error;
    throw new BotActionUnavailableError(
      "Cannot check the bot action consumer. Check Redis connectivity/CLIENT LIST permission and the bot logs; no action was queued."
    );
  } finally {
    clearTimeout(timeout);
  }
}
let actionQueue: Queue | undefined;
export async function enqueueAction(
  guildId: string,
  actorId: string,
  action: string,
  data: Record<string, any>,
  key: string
) {
  if (isDemo()) throw new Error("Live job queues are disabled in demo mode");
  const queue = (actionQueue ??= createQueue("discord-actions"));
  await assertBotActionConsumer(queue);
  return queue.add(
    action,
    { ...data, guildId, actorId },
    {
      jobId: `${guildId}-${actorId}-${key.replace(/:/g, "-")}`,
      attempts: action === "music" || action === "community" ? 1 : 5,
    }
  );
}
