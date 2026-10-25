import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "@orbit/core";
import type { Track, Resource, GuildChannel } from "@orbit/core";
import { assertMusicQueueAdmission } from "@orbit/core/music-policy";
import { routeFeedItem } from "@orbit/core/feed-routing";
const store = vi.hoisted(() => ({
  getGuild: vi.fn(),
  getResource: vi.fn(),
  listResources: vi.fn(),
  reserveDelivery: vi.fn(),
  add: vi.fn(),
}));
vi.mock("../packages/db/src/store", () => store);
vi.mock("@orbit/core/queue", () => ({
  createQueue: () => ({ add: store.add }),
}));
import { previewNewsRouting } from "../packages/db/src/news-preview";
import { dispatchItems } from "../packages/db/src/outbox";
const gid = "120000000000000001",
  channelId = "120000000000000201",
  otherChannel = "120000000000000202";
const track = (id: string, requestedById?: string): Track => ({
  id,
  title: "Clean recording",
  author: "Artist",
  uri: "",
  duration: 1000,
  requestedBy: "Same name",
  requestedById,
});
const source: Resource = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  guildId: gid,
  kind: "source",
  name: "Game updates",
  enabled: true,
  data: {
    adapter: "steam",
    appId: 10,
    channelId,
    keywords: ["patch"],
    tags: ["games"],
  },
  createdAt: "2026-10-25T00:00:00Z",
  updatedAt: "2026-10-25T00:00:00Z",
};
const route = (name: string, destination = channelId): Resource => ({
  ...source,
  id: name,
  kind: "route",
  name,
  data: {
    sourceIds: [source.id],
    channelId: destination,
    keywords: ["release"],
    tags: ["games"],
    embedColor: "#112233",
  },
});
const channels: GuildChannel[] = [
  {
    id: channelId,
    name: "general",
    type: "text",
    canSend: true,
    permissionBits: "19456",
  },
  { id: otherChannel, name: "news", type: "text", canSend: true },
];
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DEMO_MODE", "false");
  store.getGuild.mockResolvedValue({
    id: gid,
    installed: true,
    config: defaultConfig,
    channels,
    roles: [],
  });
  store.getResource.mockResolvedValue(source);
  store.listResources.mockResolvedValue([
    route("Games"),
    route("Updates", otherChannel),
  ]);
  store.reserveDelivery.mockResolvedValue({ id: "delivery" });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("optional upcoming queue fairness", () => {
  it("keeps unlimited compatibility and enforces the global queue bound", () => {
    const state = { current: track("now"), tracks: [track("a", "user")] };
    expect(() =>
      assertMusicQueueAdmission(state, "user", 5, 100, 0)
    ).not.toThrow();
    expect(() => assertMusicQueueAdmission(state, "user", 100, 100, 0)).toThrow(
      /queue limit/
    );
  });
  it("counts IDs, not mutable/duplicate display names; excludes current and legacy unknown owners", () => {
    const state = {
      current: track("now", "user"),
      tracks: [track("a", "other"), track("old")],
    };
    expect(() =>
      assertMusicQueueAdmission(state, "user", 1, 100, 1)
    ).not.toThrow();
    expect(() =>
      assertMusicQueueAdmission(
        { ...state, tracks: [track("b", "user")] },
        "user",
        1,
        100,
        1
      )
    ).toThrow(/upcoming queue/);
  });
  it("accounts for immediate playback when idle, rejects oversized playlists atomically", () => {
    const state = { current: null, tracks: [] };
    expect(() =>
      assertMusicQueueAdmission(state, "user", 2, 100, 1)
    ).not.toThrow();
    expect(() => assertMusicQueueAdmission(state, "user", 3, 100, 1)).toThrow(
      /no tracks were added/
    );
    expect(state.tracks).toEqual([]);
  });
});
describe("same routing planner in a no-fetch preview and real outbox", () => {
  const sample = { title: "Patch release", summary: "Co-op update", tags: [] };
  it("merges source tags, enforces keyword/tag/source/tenancy gates and deduplicates destinations", () => {
    const foreign = { ...route("Foreign"), guildId: "990000000000000001" };
    const disabled = { ...route("Disabled", otherChannel), enabled: false };
    const plan = routeFeedItem(
      source,
      [route("Games"), foreign, disabled],
      sample,
      channels
    );
    expect(plan.normalized.tags).toEqual(["games"]);
    expect(plan.destinations).toHaveLength(1);
    expect(plan.destinations[0]).toMatchObject({
      channelId,
      matchedBy: ["Source destination", "Games"],
      settings: { embedColor: "#112233" },
    });
    expect(
      routeFeedItem(source, [], { ...sample, title: "Unrelated" }, channels)
        .destinations
    ).toEqual([]);
    expect(
      routeFeedItem({ ...source, enabled: false }, [], sample, channels)
        .destinations
    ).toEqual([]);
  });
  it("never fetches, enqueues or writes during preview, then matches actual outbox destinations", async () => {
    const fetch = vi.fn(() => {
      throw new Error("No external I/O allowed");
    });
    vi.stubGlobal("fetch", fetch);
    const result = await previewNewsRouting(gid, {
      sourceId: source.id,
      ...sample,
    });
    expect(result).toMatchObject({
      fetchPerformed: false,
      sendPerformed: false,
      deliveryVerified: false,
      matched: true,
    });
    expect(result.destinations.map((d) => d.channelId)).toEqual([
      channelId,
      otherChannel,
    ]);
    expect(result.destinations[0].permissions).toBe("present");
    expect(result.destinations[1].permissions).toBe("unknown");
    expect(fetch).not.toHaveBeenCalled();
    expect(store.reserveDelivery).not.toHaveBeenCalled();
    expect(store.add).not.toHaveBeenCalled();
    await dispatchItems(source, [
      {
        ...sample,
        id: "sample",
        url: "https://example.invalid/routing-preview",
        publishedAt: "2026-10-25T00:00:00Z",
      },
    ]);
    expect(
      store.reserveDelivery.mock.calls.map(([row]) => row.channelId)
    ).toEqual(result.destinations.map((d) => d.channelId));
  });
  it("makes pauses, missing configuration and deleted destinations explicit without a delivery claim", async () => {
    store.getGuild.mockResolvedValue({
      installed: true,
      config: {
        ...defaultConfig,
        modules: { ...defaultConfig.modules, news: false },
      },
      channels: [],
      roles: [],
    });
    store.getResource.mockResolvedValue({
      ...source,
      data: { ...source.data, adapter: "rss", url: "" },
    });
    const result = await previewNewsRouting(gid, {
      sourceId: source.id,
      ...sample,
    });
    expect(result.destinations).toEqual([]);
    expect(result.blocked.join(" ")).toMatch(/paused/);
    expect(result.blocked.join(" ")).toMatch(/verified RSS/);
    expect(result.blocked.join(" ")).toMatch(/deleted/);
    expect(result.deliveryVerified).toBe(false);
  });
  it("rejects foreign sources, oversized samples, URL injection and partial over-limit results", async () => {
    store.getResource.mockResolvedValue(null);
    await expect(
      previewNewsRouting(gid, { sourceId: source.id, ...sample })
    ).rejects.toThrow(/this server/);
    store.getResource.mockResolvedValue(source);
    store.listResources.mockResolvedValue(
      Array.from({ length: 101 }, (_, i) => route(String(i)))
    );
    await expect(
      previewNewsRouting(gid, { sourceId: source.id, ...sample })
    ).rejects.toThrow(/no partial/);
    await expect(
      previewNewsRouting(gid, {
        sourceId: source.id,
        ...sample,
        url: "http://127.0.0.1",
      })
    ).rejects.toThrow();
    await expect(
      previewNewsRouting(gid, {
        sourceId: source.id,
        ...sample,
        title: "x".repeat(301),
      })
    ).rejects.toThrow();
  });
});
