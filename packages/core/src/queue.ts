import { Queue } from "bullmq";
import IORedis from "ioredis";
import { isDemo, required } from "./config";
let redis: IORedis | undefined;
export function redisConnection() {
  if (isDemo()) throw new Error("Live job queues are disabled in demo mode");
  return (redis ??= new IORedis(required("REDIS_URL"), {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  }));
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
let actionQueue: Queue | undefined;
export async function enqueueAction(
  guildId: string,
  actorId: string,
  action: string,
  data: Record<string, any>,
  key: string
) {
  const queue = (actionQueue ??= createQueue("discord-actions"));
  return queue.add(
    action,
    { guildId, actorId, ...data },
    {
      jobId: `${guildId}-${actorId}-${key.replace(/:/g, "-")}`,
      attempts: action === "music" ? 1 : 5,
    }
  );
}
