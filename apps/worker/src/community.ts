import type { Queue } from "bullmq";
import { assertBotActionConsumer } from "@orbit/core/queue";
import { BotActionUnavailableError } from "@orbit/core/bot-actions";
import { maintainCommunityPosts } from "@orbit/db";
/** Existing minute reconciler calls this once. Database due windows + revision claims govern retries/restarts. */
export async function reconcileCommunityPosts(
  queue: Pick<Queue, "getWorkersCount" | "add">
) {
  const due = await maintainCommunityPosts();
  if (!due.length) return 0;
  try {
    await assertBotActionConsumer(queue);
  } catch (error) {
    if (error instanceof BotActionUnavailableError) return 0;
    throw error;
  }
  for (const post of due)
    await queue.add(
      "community",
      {
        guildId: post.guildId,
        actorId: post.actorId,
        id: post.id,
        version: post.version,
        action: "publish",
        scheduled: true,
      },
      { jobId: `community-${post.id}-${post.version}`, attempts: 1 }
    );
  return due.length;
}
