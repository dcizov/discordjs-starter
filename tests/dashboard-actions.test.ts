import { EventEmitter } from "node:events";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { defaultConfig } from "@orbit/core";
import { PermissionFlagsBits, PermissionsBitField } from "discord.js";

type Request = {
  name: string;
  data: Record<string, unknown>;
  timestamp: number;
  id?: string;
};
const f = vi.hoisted(() => ({
  process: undefined as undefined | ((job: Request) => Promise<unknown>),
  ready: true,
  manager: true,
  executeCommunity: vi.fn(),
  publishPanel: vi.fn(),
  claimShopRole: vi.fn(),
  action: vi.fn(),
  shutdown: vi.fn(),
  heartbeat: vi.fn(),
  getGuild: vi.fn(),
  getResource: vi.fn(),
  setHealth: vi.fn(),
  closeDb: vi.fn(),
  closeWorker: vi.fn(),
  quit: vi.fn(),
  send: vi.fn(),
  memberFetch: vi.fn(),
}));
vi.mock("@orbit/core/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() },
}));
vi.mock("@orbit/core/queue", () => ({
  redisConnection: () => ({ quit: f.quit }),
  closeRedisConnection: f.quit,
}));
vi.mock("@orbit/db", () => ({
  audit: vi.fn(),
  closeDb: f.closeDb,
  getGuild: f.getGuild,
  getResource: f.getResource,
  setHealth: f.setHealth,
  putMusicState: vi.fn(),
  emptyMusic: () => ({}),
}));
vi.mock("../apps/bot/src/features/community", () => ({
  createCommunityRest: () => ({
    clearHashSweeper() {},
    clearHandlerSweeper() {},
  }),
  executeCommunity: f.executeCommunity,
}));
vi.mock("../apps/bot/src/features/moderation/messages", () => ({
  onMessage: vi.fn(),
}));
vi.mock("../apps/bot/src/interactions/dispatch", () => ({
  onInteraction: vi.fn(),
}));
vi.mock("../apps/bot/src/features/roles/panels", () => ({
  handleReaction: vi.fn(),
  publishPanel: f.publishPanel,
}));
vi.mock("../apps/bot/src/features/roles/shop", () => ({
  claimShopRole: f.claimShopRole,
}));
vi.mock("../apps/bot/src/infrastructure/guild-sync", () => ({
  removeGuild: vi.fn(),
  syncGuild: vi.fn(),
}));
vi.mock("../apps/bot/src/features/music/service", () => ({
  MusicService: class {
    action = f.action;
    shutdown = f.shutdown;
    heartbeat = f.heartbeat;
  },
}));
vi.mock("bullmq", () => ({
  Worker: class extends EventEmitter {
    constructor(_name: string, processor: (job: Request) => Promise<unknown>) {
      super();
      f.process = processor;
    }
    close = f.closeWorker;
    async waitUntilReady() {}
    async run() {}
  },
}));
vi.mock("discord.js", async (original) => {
  const sdk = await original<typeof import("discord.js")>();
  return {
    ...sdk,
    Client: class extends EventEmitter {
      user = { id: "120000000000000099" };
      users = { cache: new Map() };
      ws = { ping: 10 };
      guilds = {
        cache: new Map(),
        fetch: async () => ({
          members: { fetch: f.memberFetch, fetchMe: async () => ({}) },
          channels: {
            fetch: async () => ({
              isTextBased: () => true,
              permissionsFor: () => ({ has: () => true }),
              send: f.send,
            }),
          },
        }),
      };
      isReady() {
        return f.ready;
      }
      async login() {
        this.emit(sdk.Events.ClientReady);
        return "test-only-login";
      }
      destroy() {
        this.removeAllListeners();
      }
    },
  };
});
let ownSignals: {
  signal: "SIGTERM" | "SIGINT";
  listener: NodeJS.SignalsListener;
}[] = [];
beforeAll(async () => {
  vi.useFakeTimers();
  f.setHealth.mockResolvedValue(undefined);
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
  const before = {
    SIGTERM: process.listeners("SIGTERM"),
    SIGINT: process.listeners("SIGINT"),
  };
  await import("../apps/bot/src/index");
  ownSignals = (["SIGTERM", "SIGINT"] as const).flatMap((signal) =>
    process
      .listeners(signal)
      .filter((listener) => !before[signal].includes(listener))
      .map((listener) => ({ signal, listener }))
  );
  await vi.waitFor(() => expect(f.process).toBeDefined());
});
afterAll(async () => {
  ownSignals.find(({ signal }) => signal === "SIGTERM")?.listener("SIGTERM");
  await vi.waitFor(() => expect(f.closeDb).toHaveBeenCalled());
  for (const { signal, listener } of ownSignals)
    process.removeListener(signal, listener);
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
beforeEach(() => {
  vi.clearAllMocks();
  f.setHealth.mockResolvedValue(undefined);
  f.ready = true;
  f.manager = true;
  f.memberFetch.mockImplementation(async () => ({
    permissions: new PermissionsBitField(
      f.manager ? PermissionFlagsBits.ManageGuild : 0n
    ),
  }));
  f.getGuild.mockResolvedValue({ config: defaultConfig });
  f.getResource.mockResolvedValue({
    id: "source",
    kind: "source",
    name: "Sample source",
    data: { channelId: "text", embedColor: "#123456" },
  });
  f.send.mockResolvedValue({ id: "message" });
});
function action(
  name: string,
  data: Record<string, unknown> = {},
  timestamp = Date.now()
) {
  return f.process!({
    name,
    id: "test-job",
    timestamp,
    data: { guildId: "guild", actorId: "actor", ...data },
  });
}

describe("existing dashboard action consumer boundaries", () => {
  it("rejects an unavailable gateway before any actor/feature I/O", async () => {
    f.ready = false;
    await expect(action("music")).rejects.toThrow(/gateway.*reconnecting/);
    expect(f.memberFetch).not.toHaveBeenCalled();
    expect(f.action).not.toHaveBeenCalled();
  });
  it("expires stale music before member lookup or playback", async () => {
    await expect(action("music", {}, Date.now() - 30001)).rejects.toThrow(
      /expired/
    );
    expect(f.memberFetch).not.toHaveBeenCalled();
    expect(f.action).not.toHaveBeenCalled();
  });
  it("lets the publication executor enforce its own revision/actor/expiry claim", async () => {
    await action("community", { id: "post", version: 3, action: "publish" });
    expect(f.executeCommunity).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        guildId: "guild",
        actorId: "actor",
        id: "post",
        version: 3,
        requestedAt: Date.now(),
      })
    );
    expect(f.memberFetch).not.toHaveBeenCalled();
  });
  it("requires current Manage Server before panel/test actions", async () => {
    f.manager = false;
    await expect(action("publish-panel", { panelId: "panel" })).rejects.toThrow(
      /Manage Server/
    );
    expect(f.memberFetch).toHaveBeenCalledWith({ user: "actor", force: true });
    expect(f.publishPanel).not.toHaveBeenCalled();
  });
  it("dispatches role publication without changing trusted guild/actor identifiers", async () => {
    await action("publish-panel", { panelId: "panel" });
    expect(f.publishPanel).toHaveBeenCalledWith(
      expect.anything(),
      "guild",
      "panel",
      "actor"
    );
  });
  it.each(["music", "claim-role"])(
    "delegates %s's stricter voice/entitlement rules without imposing Manage Server",
    async (name) => {
      f.manager = false;
      await action(name, { itemId: "item" });
      expect(name === "music" ? f.action : f.claimShopRole).toHaveBeenCalled();
    }
  );
  it("suppresses mentions and enforces a stable nonce on an explicit test message", async () => {
    await action("test-message", { sourceId: "source" });
    expect(f.getResource).toHaveBeenCalledWith("guild", "source");
    expect(f.send).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedMentions: { parse: [] },
        enforceNonce: true,
        nonce: expect.any(String),
      })
    );
  });
  it("refuses test messages when news is paused", async () => {
    f.getGuild.mockResolvedValue({
      config: {
        ...defaultConfig,
        modules: { ...defaultConfig.modules, news: false },
      },
    });
    await expect(
      action("test-message", { sourceId: "source" })
    ).rejects.toThrow(/news paused/);
    expect(f.send).not.toHaveBeenCalled();
  });
  it("refuses unknown jobs and persists only sanitized failure reasons", async () => {
    await expect(action("unknown")).rejects.toThrow(/Unknown bot action/);
    f.action.mockRejectedValueOnce(
      new Error("Request failed password=private-value")
    );
    await expect(action("music")).rejects.not.toThrow(/private-value/);
  });
});
