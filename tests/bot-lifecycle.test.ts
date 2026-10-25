import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Events,
  GatewayCloseCodes,
  GatewayIntentBits,
  Partials,
  type ClientOptions,
} from "discord.js";
import { gatewayIntentNames } from "@orbit/core/permissions";

const f = vi.hoisted(() => ({
  client: undefined as
    | undefined
    | (EventEmitter & { user: { id: string }; destroy: () => Promise<void> }),
  options: undefined as ClientOptions | undefined,
  login: vi.fn(),
  destroy: vi.fn(),
  detach: vi.fn(),
  attach: vi.fn(),
  maintenance: vi.fn(),
  stopMaintenance: vi.fn(),
  createWorker: vi.fn(),
  wait: vi.fn(),
  run: vi.fn(),
  closeWorker: vi.fn(),
  heartbeat: vi.fn(),
  musicShutdown: vi.fn(),
  redisClose: vi.fn(),
  dbClose: vi.fn(),
  health: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));
vi.mock("@orbit/core/logger", () => ({
  logger: { info: f.info, warn: vi.fn(), error: f.error, fatal: f.fatal },
}));
vi.mock("@orbit/core/queue", () => ({ closeRedisConnection: f.redisClose }));
vi.mock("@orbit/db", () => ({ closeDb: f.dbClose, setHealth: f.health }));
vi.mock("../apps/bot/src/events/gateway", () => ({
  attachGatewayEvents: f.attach,
}));
vi.mock("../apps/bot/src/infrastructure/maintenance", () => ({
  startMaintenance: f.maintenance,
}));
vi.mock("../apps/bot/src/infrastructure/action-consumer", () => ({
  createActionConsumer: f.createWorker,
}));
vi.mock("../apps/bot/src/features/community", () => ({
  createCommunityRest: () => ({
    clearHashSweeper() {},
    clearHandlerSweeper() {},
  }),
}));
vi.mock("../apps/bot/src/features/music/service", () => ({
  MusicService: class {
    heartbeat = f.heartbeat;
    shutdown = f.musicShutdown;
  },
}));
vi.mock("discord.js", async (original) => {
  const sdk = await original<typeof import("discord.js")>();
  return {
    ...sdk,
    Client: class extends EventEmitter {
      user = { id: "120000000000000099" };
      guilds = { cache: new Map() };
      constructor(options: ClientOptions) {
        super();
        f.client = this;
        f.options = options;
      }
      async login() {
        await f.login();
        this.emit(sdk.Events.ClientReady);
        return "test-only-login";
      }
      destroy = f.destroy;
    },
  };
});
import { startBot } from "../apps/bot/src/bootstrap";
const originalExitCode = process.exitCode;
let runtime: Awaited<ReturnType<typeof startBot>>;
let beforeSignals: {
  SIGINT: NodeJS.SignalsListener[];
  SIGTERM: NodeJS.SignalsListener[];
};
beforeEach(() => {
  vi.clearAllMocks();
  runtime = undefined;
  f.client = undefined;
  f.options = undefined;
  beforeSignals = {
    SIGINT: process.listeners("SIGINT"),
    SIGTERM: process.listeners("SIGTERM"),
  };
  for (const [key, value] of Object.entries({
    DEMO_MODE: "false",
    DATABASE_URL: "postgres://test:test@localhost/orbit_test",
    REDIS_URL: "redis://localhost",
    DISCORD_TOKEN: "test-only-token",
    DISCORD_CLIENT_ID: "120000000000000099",
    LAVALINK_URL: "",
    LAVALINK_PASSWORD: "",
  }))
    vi.stubEnv(key, value);
  for (const mock of [
    f.login,
    f.destroy,
    f.stopMaintenance,
    f.wait,
    f.run,
    f.closeWorker,
    f.musicShutdown,
    f.redisClose,
    f.dbClose,
    f.health,
  ])
    mock.mockResolvedValue(undefined);
  f.attach.mockReturnValue(f.detach);
  f.maintenance.mockResolvedValue(f.stopMaintenance);
  f.createWorker.mockReturnValue({
    waitUntilReady: f.wait,
    run: f.run,
    close: f.closeWorker,
  });
});
afterEach(async () => {
  await runtime?.stop();
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    expect(process.listeners(signal)).toEqual(beforeSignals[signal]);
  vi.unstubAllEnvs();
  process.exitCode = originalExitCode;
});

describe("explicit bot startup/stop ownership (no Discord/Redis connections)", () => {
  it("keeps demo from constructing gateway, music, workers or signal handlers", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    runtime = await startBot();
    expect(runtime).toBeUndefined();
    expect(f.client).toBeUndefined();
    expect(f.createWorker).not.toHaveBeenCalled();
  });
  it("constructs exactly the declared intents/partials and starts the consumer after readiness", async () => {
    runtime = await startBot();
    await runtime!.ready;
    expect(f.options).toMatchObject({
      intents: gatewayIntentNames.map((name) => GatewayIntentBits[name]),
      partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction,
        Partials.User,
      ],
    });
    expect(f.maintenance.mock.invocationCallOrder[0]).toBeLessThan(
      f.createWorker.mock.invocationCallOrder[0]
    );
    expect(f.wait.mock.invocationCallOrder[0]).toBeLessThan(
      f.run.mock.invocationCallOrder[0]
    );
    expect(f.createWorker).toHaveBeenCalledTimes(1);
  });
  it("shares one stop promise, drains jobs before music and detaches only owned lifecycle handlers", async () => {
    runtime = await startBot();
    await runtime!.ready;
    const stop = runtime!.stop();
    expect(runtime!.stop()).toBe(stop);
    await stop;
    expect(f.closeWorker).toHaveBeenCalledExactlyOnceWith(false);
    expect(f.closeWorker.mock.invocationCallOrder[0]).toBeLessThan(
      f.musicShutdown.mock.invocationCallOrder[0]
    );
    expect(f.musicShutdown.mock.invocationCallOrder[0]).toBeLessThan(
      f.destroy.mock.invocationCallOrder[0]
    );
    expect(f.detach).toHaveBeenCalledTimes(1);
    expect(f.stopMaintenance).toHaveBeenCalledTimes(1);
    expect(f.redisClose).toHaveBeenCalledTimes(1);
    expect(f.dbClose).toHaveBeenCalledTimes(1);
    expect(f.client!.listenerCount(Events.ClientReady)).toBe(0);
    expect(f.client!.listenerCount(Events.ShardDisconnect)).toBe(0);
  });
  it("does not allocate a consumer after stop while initial snapshots are still awaiting I/O", async () => {
    let finish!: (value: typeof f.stopMaintenance) => void;
    f.maintenance.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    runtime = await startBot();
    const stop = runtime!.stop();
    finish(f.stopMaintenance);
    await stop;
    expect(f.createWorker).not.toHaveBeenCalled();
    expect(f.stopMaintenance).toHaveBeenCalledTimes(1);
  });
  it("interrupts pending queue readiness and force-closes only the not-yet-running consumer", async () => {
    f.wait.mockReturnValueOnce(new Promise(() => {}));
    runtime = await startBot();
    await vi.waitFor(() => expect(f.wait).toHaveBeenCalled());
    await runtime!.stop();
    expect(f.closeWorker).toHaveBeenCalledExactlyOnceWith(true);
    expect(f.run).not.toHaveBeenCalled();
    expect(
      f.info.mock.calls.some((call) =>
        call.includes("Orbit is ready; dashboard action consumer is listening")
      )
    ).toBe(false);
  });
  it("continues gateway/Redis/database cleanup after worker and music close failures", async () => {
    runtime = await startBot();
    await runtime!.ready;
    f.closeWorker.mockRejectedValueOnce(
      new Error("close failed password=private-value")
    );
    f.musicShutdown.mockRejectedValueOnce(new Error("music close failed"));
    await runtime!.stop();
    expect(f.destroy).toHaveBeenCalled();
    expect(f.redisClose).toHaveBeenCalled();
    expect(f.dbClose).toHaveBeenCalled();
    expect(f.error).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(f.error.mock.calls)).not.toContain("private-value");
  });
  it("cleans up after login rejection instead of exiting with open listeners/resources", async () => {
    f.login.mockRejectedValueOnce(new Error("invalid test login"));
    await expect(startBot()).rejects.toThrow("invalid test login");
    expect(f.createWorker).not.toHaveBeenCalled();
    expect(f.destroy).toHaveBeenCalled();
    expect(f.dbClose).toHaveBeenCalled();
  });
  it("refuses a mismatched application identity before starting maintenance/consumption", async () => {
    vi.stubEnv("DISCORD_CLIENT_ID", "120000000000000098");
    runtime = await startBot();
    await expect(runtime!.ready).rejects.toThrow(/does not match/);
    await runtime!.stop();
    expect(f.maintenance).not.toHaveBeenCalled();
    expect(f.createWorker).not.toHaveBeenCalled();
  });
  it("shuts down on disallowed intents and safely coalesces competing signals", async () => {
    runtime = await startBot();
    await runtime!.ready;
    const signalHandlers = process
      .listeners("SIGTERM")
      .filter((listener) => !beforeSignals.SIGTERM.includes(listener));
    f.client!.emit(Events.ShardDisconnect, {
      code: GatewayCloseCodes.DisallowedIntents,
    });
    for (const handler of signalHandlers) handler("SIGTERM");
    await runtime!.stop();
    expect(f.closeWorker).toHaveBeenCalledTimes(1);
    expect(f.fatal).toHaveBeenCalled();
  });
});
