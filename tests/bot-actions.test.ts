import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertFreshBotAction,
  BotActionPendingError,
  BotActionUnavailableError,
  MUSIC_ACTION_MAX_AGE_MS,
  waitForBotAction,
} from "../packages/core/src/bot-actions";

const queue = vi.hoisted(() => ({ getWorkersCount: vi.fn(), add: vi.fn() }));
vi.mock("bullmq", () => ({
  Queue: class {
    constructor() {
      return queue;
    }
  },
}));
vi.mock("ioredis", () => ({ default: class {} }));
import { enqueueAction } from "../packages/core/src/queue";

beforeEach(() => {
  vi.stubEnv("DEMO_MODE", "false");
  vi.stubEnv("REDIS_URL", "redis://localhost:6379");
  vi.clearAllMocks();
  queue.getWorkersCount.mockResolvedValue(1);
  queue.add.mockResolvedValue({ id: "receipt-1" });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("live dashboard action admission", () => {
  const enqueue = () =>
    enqueueAction(
      "120000000000000001",
      "120000000000000099",
      "music",
      { action: "play", query: "approved track" },
      "one-request"
    );
  it("rejects an offline bot before enqueueing anything", async () => {
    queue.getWorkersCount.mockResolvedValue(0);
    await expect(enqueue()).rejects.toMatchObject({
      status: 503,
      code: "BOT_UNAVAILABLE",
    });
    expect(queue.add).not.toHaveBeenCalled();
  });
  it("preserves scoped jobs and no automatic replay attempts for music", async () => {
    await expect(enqueue()).resolves.toEqual({ id: "receipt-1" });
    expect(queue.add).toHaveBeenCalledWith(
      "music",
      expect.objectContaining({
        guildId: "120000000000000001",
        actorId: "120000000000000099",
        action: "play",
      }),
      expect.objectContaining({ attempts: 1 })
    );
  });
  it("fails closed when Redis cannot report consumers", async () => {
    queue.getWorkersCount.mockRejectedValue(
      new Error("redis://private:secret@redis")
    );
    await expect(enqueue()).rejects.toBeInstanceOf(BotActionUnavailableError);
    await expect(enqueue()).rejects.not.toThrow("secret");
    expect(queue.add).not.toHaveBeenCalled();
  });
  it("bounds a disconnected Redis check instead of hanging an HTTP action forever", async () => {
    vi.useFakeTimers();
    queue.getWorkersCount.mockReturnValue(new Promise(() => {}));
    const result = expect(enqueue()).rejects.toMatchObject({ status: 503 });
    await vi.advanceTimersByTimeAsync(3001);
    await result;
    expect(queue.add).not.toHaveBeenCalled();
  });
  it("retains the demo guard even before an offline-consumer check", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    await expect(enqueueAction("g", "a", "music", {}, "k")).rejects.toThrow(
      "disabled in demo"
    );
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe("accepted is not completed", () => {
  it("waits through waiting/active and only resolves on completed", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ state: "waiting" })
      .mockResolvedValueOnce({ state: "active" })
      .mockResolvedValueOnce({ state: "completed", result: { queued: 1 } });
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(waitForBotAction("j", read, { sleep })).resolves.toMatchObject(
      { state: "completed" }
    );
    expect(read).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });
  it("surfaces worker failure instead of a success toast", async () => {
    await expect(
      waitForBotAction("j", async () => ({
        state: "failed",
        error: "Join a voice channel first.",
      }))
    ).rejects.toThrow("Join a voice channel first");
  });
  it.each(["waiting", "active", "delayed"])(
    "does not report an indefinitely %s job as success",
    async (state) => {
      await expect(
        waitForBotAction("j", async () => ({ state }), {
          attempts: 2,
          sleep: async () => {},
        })
      ).rejects.toBeInstanceOf(BotActionPendingError);
    }
  );
  it("does not turn a missing receipt into completion", async () => {
    await expect(
      waitForBotAction("j", async () => ({ state: "unknown" }))
    ).rejects.toThrow("not confirmed");
  });
});

describe("stopped bots never replay old music requests", () => {
  it("allows a fresh request but rejects stale play/skip without provider or Discord I/O", () => {
    expect(() =>
      assertFreshBotAction("music", 1000, 1000 + MUSIC_ACTION_MAX_AGE_MS)
    ).not.toThrow();
    expect(() =>
      assertFreshBotAction("music", 1000, 1001 + MUSIC_ACTION_MAX_AGE_MS)
    ).toThrow("expired");
    expect(() => assertFreshBotAction("music", NaN)).toThrow("expired");
    expect(() =>
      assertFreshBotAction("publish-panel", 0, 1000000)
    ).not.toThrow();
  });
});
