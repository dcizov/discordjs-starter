import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const deps = vi.hoisted(() => ({
  authorize: vi.fn(),
  enqueueAction: vi.fn(),
  audit: vi.fn(),
  dashboard: vi.fn(),
  putMusicState: vi.fn(),
  job: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  authorize: deps.authorize,
  HttpError: class extends Error {
    constructor(
      public status: number,
      message: string
    ) {
      super(message);
    }
  },
}));
vi.mock("@/lib/dashboard", () => ({ loadDashboard: vi.fn() }));
vi.mock("@/lib/security", () => ({
  assertOrigin: vi.fn(),
  rateLimit: vi.fn(),
  body: (req: Request) => req.json(),
}));
vi.mock("@orbit/core/queue", () => ({
  enqueueAction: deps.enqueueAction,
  createQueue: () => ({ getJob: deps.job, close: deps.close }),
}));
vi.mock("@orbit/db", () => ({
  audit: deps.audit,
  database: vi.fn(),
  deleteResource: vi.fn(),
  economyTransaction: vi.fn(),
  getDashboardData: deps.dashboard,
  getGuild: vi.fn(),
  queryHistory: vi.fn(),
  getResource: vi.fn(),
  putMusicState: deps.putMusicState,
  reserveDelivery: vi.fn(),
  saveConfig: vi.fn(),
  saveResource: vi.fn(),
  schema: {},
}));
vi.mock("@orbit/db/src/demo", () => ({ demoTransaction: vi.fn() }));
import { POST, GET } from "../apps/web/app/api/[...path]/route";
import { BotActionUnavailableError } from "../packages/core/src/bot-actions";
import { HttpError } from "../apps/web/lib/auth";
const guildId = "120000000000000001",
  actorId = "120000000000000099";
const context = (tail: string[]) => ({
  params: Promise.resolve({ path: ["guilds", guildId, ...tail] }),
});
const post = (value: object) =>
  POST(
    new Request(`http://localhost:3000/api/guilds/${guildId}/music`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(value),
    }),
    context(["music"])
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DEMO_MODE", "false");
  deps.authorize.mockResolvedValue({
    user: { id: actorId, name: "Member" },
    guild: { installed: true },
  });
  deps.dashboard.mockResolvedValue({
    guild: { config: { modules: { music: true }, music: { maxQueue: 50 } } },
    music: { current: null, tracks: [], position: 0 },
  });
  deps.enqueueAction.mockResolvedValue({ id: "one-scoped-job" });
  deps.audit.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("real music route response contract (mocked I/O, no Discord)", () => {
  it("returns 503 and no success/audit when the bot consumer is absent", async () => {
    deps.enqueueAction.mockRejectedValueOnce(new BotActionUnavailableError());
    const response = await post({
      action: "play",
      query: "Clean public recording",
    });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toContain("bot is offline");
    expect(deps.audit).not.toHaveBeenCalled();
    expect(deps.putMusicState).not.toHaveBeenCalled();
  });
  it("returns Accepted, not completed/playing, for an admitted live job", async () => {
    const response = await post({
      action: "play",
      query: "Clean public recording",
      guildId: "untrusted",
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      accepted: true,
      demo: false,
      jobId: "one-scoped-job",
    });
    expect(deps.enqueueAction).toHaveBeenCalledWith(
      guildId,
      actorId,
      "music",
      { action: "play", query: "Clean public recording" },
      expect.any(String)
    );
  });
  it("authorizes the mutation before accessing the queue", async () => {
    deps.authorize.mockRejectedValueOnce(
      new HttpError(403, "Manage Server required")
    );
    expect((await post({ action: "play", query: "Track" })).status).toBe(403);
    expect(deps.enqueueAction).not.toHaveBeenCalled();
  });
  it("keeps demo playback purely local and never touches the live queue", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const response = await post({ action: "play", query: "Fictional preview" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, demo: true });
    expect(deps.putMusicState).toHaveBeenCalled();
    expect(deps.enqueueAction).not.toHaveBeenCalled();
  });
  it.each([
    { guildId: "120000000000000002", actorId },
    { guildId, actorId: "120000000000000100" },
  ])("does not reveal another guild or actor's job receipt", async (data) => {
    deps.job.mockResolvedValueOnce({ data });
    const response = await GET(
      new Request("http://localhost:3000/"),
      context(["actions", "some-job"])
    );
    expect(response.status).toBe(404);
    expect(deps.close).toHaveBeenCalled();
  });
});
