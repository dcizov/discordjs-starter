// CI-only real Redis/BullMQ smoke. There is no Discord client, gateway login,
// provider request, database mutation, or MusicService import in this program.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { QueueEvents, Worker, type Job } from "bullmq";
import { assertFreshBotAction } from "../../packages/core/src/bot-actions";
import {
  createQueue,
  enqueueAction,
  redisConnection,
} from "../../packages/core/src/queue";

if (
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.ORBIT_ACTION_QUEUE_SMOKE !== "true" ||
  process.env.DEMO_MODE !== "true" ||
  process.env.DISCORD_TOKEN ||
  process.env.DISCORD_CLIENT_SECRET
)
  throw new Error(
    "Run only in the credential-free, isolated CI Dev Container project."
  );
process.env.DEMO_MODE = "false"; // Exercise the real queue, but never a real Discord consumer.
const queue = createQueue("discord-actions");
const events = new QueueEvents("discord-actions", {
  connection: redisConnection(),
});
let worker: Worker | undefined;
const jobs: Job[] = [];
const guild = "120000000000000001",
  actor = "120000000000000099";
let executed = 0;
try {
  await Promise.all([queue.waitUntilReady(), events.waitUntilReady()]);
  assert.equal(
    await queue.getWorkersCount(),
    0,
    "Editor must not implicitly start a gateway/action consumer"
  );
  await assert.rejects(
    enqueueAction(guild, actor, "music", { action: "play" }, randomUUID()),
    { code: "BOT_UNAVAILABLE" }
  );
  worker = new Worker(
    "discord-actions",
    async (job) => {
      assertFreshBotAction(job.name, job.timestamp);
      assert.equal(job.data.guildId, guild);
      assert.equal(job.data.actorId, actor);
      executed++;
      return { processed: true, noDiscordOrAudio: true };
    },
    { connection: redisConnection() }
  );
  await worker.waitUntilReady();
  const job = await enqueueAction(
    guild,
    actor,
    "music",
    {
      action: "play",
      guildId: "untrusted-override",
      actorId: "untrusted-override",
    },
    randomUUID()
  );
  jobs.push(job);
  assert.deepEqual(await job.waitUntilFinished(events, 10000), {
    processed: true,
    noDiscordOrAudio: true,
  });
  const stale = await queue.add(
    "music",
    { guildId: guild, actorId: actor, action: "play" },
    { jobId: randomUUID(), timestamp: Date.now() - 31000, attempts: 1 }
  );
  jobs.push(stale);
  await assert.rejects(stale.waitUntilFinished(events, 10000), /expired/);
  assert.equal(executed, 1, "A stale music job must fail before execution");
  await worker.close();
  worker = undefined;
  await assert.rejects(
    enqueueAction(guild, actor, "music", { action: "skip" }, randomUUID()),
    { code: "BOT_UNAVAILABLE" }
  );
  console.log(
    "Real action bridge: offline rejection, scoped execution, stale-job rejection and stopped-consumer rejection PASS (no Discord/audio)."
  );
} finally {
  await worker?.close();
  for (const job of jobs) await job.remove(); // Only our own test jobs, never a queue-wide drain/reset.
  await events.close();
  await queue.close();
  await redisConnection().quit();
}
