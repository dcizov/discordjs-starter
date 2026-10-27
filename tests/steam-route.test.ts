import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The dashboard test flight, executed through the real route handler with the
 * recorded Steam response stubbed in at the `fetch` boundary. This is the layer
 * the browser renders from: it proves the production path (authorize → adapter →
 * normalizer → `newsCard`) turns real provider bytes into clean cards, without
 * network access or a database.
 */
const deps = vi.hoisted(() => ({
  authorize: vi.fn(),
  loadDashboard: vi.fn(),
  getResource: vi.fn(),
  saveResource: vi.fn(),
  assertOrigin: vi.fn(),
  rateLimit: vi.fn(),
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
vi.mock("@/lib/dashboard", () => ({ loadDashboard: deps.loadDashboard }));
vi.mock("@/lib/security", () => ({
  assertOrigin: deps.assertOrigin,
  rateLimit: deps.rateLimit,
  body: (req: Request) => req.json(),
}));
vi.mock("@orbit/core/queue", () => ({
  enqueueAction: vi.fn(),
  createQueue: () => ({ getJob: vi.fn(), close: vi.fn() }),
}));
vi.mock("@orbit/db", () => ({
  audit: vi.fn(),
  database: vi.fn(),
  deleteResource: vi.fn(),
  economyTransaction: vi.fn(),
  getDashboardData: vi.fn(),
  getGuild: vi.fn(),
  getResource: deps.getResource,
  listResources: vi.fn(),
  queryHistory: vi.fn(),
  putMusicState: vi.fn(),
  reserveDelivery: vi.fn(),
  saveConfig: vi.fn(),
  saveResource: deps.saveResource,
  schema: {},
}));
vi.mock("@orbit/db/src/demo", () => ({ demoTransaction: vi.fn() }));

import { POST } from "../apps/web/app/api/[...path]/route";

const guildId = "120000000000000001";
const sourceId = "3f7c2f56-2f9c-4d8f-9c1e-8f6c3d2b1a09";
const capture = JSON.parse(
  readFileSync(resolve("tests/fixtures/steam/730-2026-10-25.json"), "utf8")
);

const context = {
  params: Promise.resolve({
    path: ["guilds", guildId, "resources", "source", sourceId, "test"],
  }),
};

const testFlight = () =>
  POST(
    new Request(
      `http://localhost:3000/api/guilds/${guildId}/resources/source/${sourceId}/test`,
      { method: "POST" }
    ),
    context
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DEMO_MODE", "false");
  deps.authorize.mockResolvedValue({
    user: { id: "120000000000000099", name: "Member" },
    guild: { installed: true },
  });
  deps.getResource.mockResolvedValue({
    id: sourceId,
    guildId,
    kind: "source",
    name: "CS2 updates",
    enabled: true,
    data: {
      adapter: "steam",
      appId: 730,
      tags: [],
      officialOnly: false,
      channelId: "120000000000000001",
      includeSummary: true,
      embedColor: "#8b5cf6",
    },
  });
  deps.saveResource.mockResolvedValue(undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(capture), {
          headers: { "content-type": "application/json" },
        })
    )
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("test flight over the recorded Steam response", () => {
  it("requests full content from the documented endpoint without inventing a key", async () => {
    await testFlight();
    const called = String((globalThis.fetch as any).mock.calls[0][0]);
    const url = new URL(called);
    expect(url.origin + url.pathname).toBe(
      "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/"
    );
    expect(url.searchParams.get("appid")).toBe("730");
    expect(url.searchParams.get("maxlength")).toBe("0");
    expect(url.searchParams.has("key")).toBe(false);
  });

  it("returns normalized cards with no provider markup left", async () => {
    const response = await testFlight();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.count).toBe(4);
    expect(body.shown).toBe(3);
    const serialized = JSON.stringify(body.items);
    expect(serialized).not.toContain("[/*]");
    expect(serialized).not.toContain("[/p]");
    expect(serialized).not.toContain("\\\\[");
    const [first] = body.items;
    expect(first.title).toBe("Counter-Strike 2 Update");
    expect(first.sourceLabel).toBe("Community Announcements");
    expect(first.subscriptionLabel).toBe("CS2 updates");
    expect(first.attributionLabel).toBe("App announcement");
    expect(first.linkLabel).toBe("Read the announcement");
    expect(first.publisher).toBe("");
    expect(first.excerpt.split("\n")[0]).toBe("[ MAP SCRIPTING ]");
    // No per-card diagnostics for a complete item with no image.
    expect(first.notices).toEqual([]);
  });

  it("shows the publisher for a syndicated item inside the preview", async () => {
    // Serve only the recorded syndicated item, so it is the one rendered.
    const syndicatedOnly = {
      appnews: {
        ...capture.appnews,
        newsitems: [
          capture.appnews.newsitems.find(
            (item: any) => item.feedname === "Rock, Paper, Shotgun"
          ),
        ],
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(syndicatedOnly), {
            headers: { "content-type": "application/json" },
          })
      )
    );
    const body = await (await testFlight()).json();
    const [card] = body.items;
    expect(card.publisher).toBe("Rock, Paper, Shotgun");
    expect(card.sourceLabel).toBe("Rock, Paper, Shotgun");
    expect(card.subscriptionLabel).toBe("CS2 updates");
    expect(card.attributionLabel).toBe("Republished from Rock, Paper, Shotgun");
    expect(card.linkLabel).toBe("Read the article at Rock, Paper, Shotgun");
    // The administrator's label is never presented as the author.
    expect(JSON.stringify(card)).not.toContain("Read more from CS2 updates");
  });

  it("passes the official-only switch to the provider instead of post-filtering", async () => {
    deps.getResource.mockResolvedValueOnce({
      id: sourceId,
      guildId,
      kind: "source",
      name: "CS2 updates",
      enabled: true,
      data: {
        adapter: "steam",
        appId: 730,
        tags: [],
        officialOnly: true,
        channelId: "120000000000000001",
      },
    });
    const response = await testFlight();
    const url = new URL(String((globalThis.fetch as any).mock.calls[0][0]));
    expect(url.searchParams.get("feeds")).toBe("steam_community_announcements");
    expect((await response.json()).officialOnly).toBe(true);
  });

  it("surfaces a provider failure instead of rendering an empty success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("upstream burned", {
            status: 503,
            headers: { "retry-after": "120" },
          })
      )
    );
    const response = await testFlight();
    // A provider outage is a bad gateway, not a bad request: the administrator
    // did nothing wrong and should be told to retry.
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.error).toContain("Integration returned HTTP 503");
    expect(body.retryAfterSeconds).toBe(120);
    expect(body.items).toBeUndefined();
    expect(deps.saveResource).not.toHaveBeenCalled();
  });
});
