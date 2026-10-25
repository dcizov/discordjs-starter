import { beforeEach, describe, expect, it, vi } from "vitest";
const deps = vi.hoisted(() => ({
  maintain: vi.fn(),
  consumer: vi.fn(),
  add: vi.fn(),
}));
vi.mock("@orbit/db", () => ({ maintainCommunityPosts: deps.maintain }));
vi.mock("@orbit/core/queue", () => ({
  assertBotActionConsumer: deps.consumer,
}));
import { BotActionUnavailableError } from "@orbit/core/bot-actions";
import { reconcileCommunityPosts } from "../apps/worker/src/community";
const post = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  guildId: "120000000000000001",
  actorId: "120000000000000099",
  version: 4,
};
const queue = { getWorkersCount: vi.fn(), add: deps.add };
beforeEach(() => {
  vi.clearAllMocks();
  deps.maintain.mockResolvedValue([post]);
  deps.consumer.mockResolvedValue(undefined);
  deps.add.mockResolvedValue(undefined);
});
describe("durable announcement reconciliation, mocked Redis", () => {
  it("runs maintenance even without a bot but queues no unconsumable work", async () => {
    deps.consumer.mockRejectedValue(new BotActionUnavailableError());
    expect(await reconcileCommunityPosts(queue)).toBe(0);
    expect(deps.maintain).toHaveBeenCalled();
    expect(deps.add).not.toHaveBeenCalled();
  });
  it("preserves the approver/revision, stable job ID and one create attempt across repeated scans", async () => {
    expect(await reconcileCommunityPosts(queue)).toBe(1);
    expect(await reconcileCommunityPosts(queue)).toBe(1);
    expect(deps.add).toHaveBeenCalledWith(
      "community",
      { ...post, action: "publish", scheduled: true },
      { jobId: `community-${post.id}-4`, attempts: 1 }
    );
  });
  it("skips consumer checks when no current-window jobs are due", async () => {
    deps.maintain.mockResolvedValue([]);
    expect(await reconcileCommunityPosts(queue)).toBe(0);
    expect(deps.consumer).not.toHaveBeenCalled();
  });
  it("leaves failed Redis admissions visible to the caller for next-minute reconciliation", async () => {
    deps.add.mockRejectedValue(new Error("Redis unavailable"));
    await expect(reconcileCommunityPosts(queue)).rejects.toThrow(
      /Redis unavailable/
    );
  });
});
