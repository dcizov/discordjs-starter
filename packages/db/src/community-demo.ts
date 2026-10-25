import { isDemo } from "@orbit/core";
import {
  getCommunityPost,
  claimCommunityPost,
  finishCommunityPost,
  recordCommunityResult,
} from "./community";
/** Isolated simulation: never imports a REST client or enqueues a live job. */
export async function simulateCommunityAction(
  guildId: string,
  id: string,
  version: number,
  actorId: string,
  action: "publish" | "refresh" | "close"
) {
  if (!isDemo())
    throw new Error("Simulation is available only in isolated demo mode.");
  const post = await getCommunityPost(guildId, id);
  if (!post) throw new Error("Post not found.");
  if (action === "publish") {
    const claimed = await claimCommunityPost(
      guildId,
      id,
      version,
      actorId,
      false
    );
    return finishCommunityPost(guildId, id, claimed.version, actorId, {
      state: "published",
      result: post.poll
        ? {
            checkedAt: new Date().toISOString(),
            expiresAt: new Date(
              Date.now() + post.poll.durationHours * 3600_000
            ).toISOString(),
            finalized: false,
            answers: post.poll.answers.map((text, i) => ({
              id: i + 1,
              text,
              votes: null,
            })),
          }
        : null,
    });
  }
  if (post.kind !== "poll" || !post.poll)
    throw new Error("Only native polls have results.");
  return recordCommunityResult(
    guildId,
    id,
    version,
    actorId,
    {
      checkedAt: new Date().toISOString(),
      expiresAt:
        action === "close"
          ? new Date().toISOString()
          : (post.result?.expiresAt ?? null),
      finalized: false,
      answers: post.poll.answers.map((text, i) => ({
        id: i + 1,
        text,
        votes: null,
      })),
    },
    action === "close"
  );
}
