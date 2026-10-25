import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  create: vi.fn(),
  quit: vi.fn(),
  disconnect: vi.fn(),
  status: "ready",
}));
vi.mock("ioredis", () => ({
  default: class {
    constructor() {
      f.create();
    }
    get status() {
      return f.status;
    }
    quit = f.quit;
    disconnect = f.disconnect;
  },
}));
import { closeRedisConnection, redisConnection } from "@orbit/core/queue";
beforeEach(() => {
  vi.clearAllMocks();
  f.status = "ready";
  f.quit.mockResolvedValue("OK");
  vi.stubEnv("DEMO_MODE", "false");
  vi.stubEnv("REDIS_URL", "redis://localhost");
});
afterEach(async () => {
  await closeRedisConnection();
  vi.unstubAllEnvs();
});
describe("Redis connection shutdown ownership", () => {
  it("never connects to Redis merely to stop an unused service", async () => {
    await closeRedisConnection();
    expect(f.create).not.toHaveBeenCalled();
  });
  it("quits an established connection once and clears the cache", async () => {
    redisConnection();
    await closeRedisConnection();
    await closeRedisConnection();
    expect(f.quit).toHaveBeenCalledOnce();
    expect(f.disconnect).not.toHaveBeenCalled();
    redisConnection();
    expect(f.create).toHaveBeenCalledTimes(2);
  });
  it("disconnects an unavailable/retrying connection instead of queueing QUIT indefinitely", async () => {
    f.status = "reconnecting";
    redisConnection();
    await closeRedisConnection();
    expect(f.disconnect).toHaveBeenCalledOnce();
    expect(f.quit).not.toHaveBeenCalled();
  });
});
