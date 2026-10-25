import { EventEmitter } from "node:events";
import {
  ChannelType,
  PermissionFlagsBits,
  PermissionsBitField,
  type Client,
  type GuildMember,
} from "discord.js";
import type { Player } from "shoukaku";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../packages/core/src/config";

const db = vi.hoisted(() => ({
  getGuild: vi.fn(),
  putMusicState: vi.fn(),
  setHealth: vi.fn(),
  emptyMusic: () => ({
    tracks: [],
    current: null,
    paused: false,
    volume: 65,
    repeat: "off",
    position: 0,
    updatedAt: "",
  }),
  audit: vi.fn(),
}));
vi.mock("@orbit/db", () => db);
vi.mock("@orbit/core/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
import { MusicService } from "../apps/bot/src/features/music/service";
import {
  MusicSearchSessions,
  SEARCH_SESSION_TTL_MS,
  durationLabel,
  searchResultComponents,
} from "../apps/bot/src/features/music/search-session";

const guildId = "120000000000000002",
  memberId = "120000000000000099",
  voiceId = "120000000000000208";
const track = (title: string, encoded = `encoded-${title}`) => ({
  encoded,
  title,
  author: "Artist",
  duration: 180000,
  uri: "https://soundcloud.com/example/track",
  source: "soundcloud",
});

function sessionStore(now = () => 1000) {
  return new MusicSearchSessions(now, SEARCH_SESSION_TTL_MS);
}

describe("expiring, member-bound search selections", () => {
  it("binds a menu to one member and one guild", () => {
    const store = sessionStore();
    const session = store.create({
      guildId,
      userId: memberId,
      tracks: [track("One")],
    });
    expect(
      store.claim(session.id, { guildId, userId: "120000000000000100" })
    ).toBe(null);
    expect(
      store.claim(session.id, {
        guildId: "120000000000000003",
        userId: memberId,
      })
    ).toBeNull();
    // Another member's attempt does not consume the owner's results.
    expect(
      store.claim(session.id, { guildId, userId: memberId })
    ).toMatchObject({
      tracks: [{ title: "One" }],
    });
  });

  it("can be used exactly once and expires", () => {
    const now = { value: 1000 };
    const store = sessionStore(() => now.value);
    const session = store.create({
      guildId,
      userId: memberId,
      tracks: [track("One")],
    });
    expect(
      store.claim(session.id, { guildId, userId: memberId })
    ).not.toBeNull();
    expect(store.claim(session.id, { guildId, userId: memberId })).toBeNull();

    const expiring = store.create({
      guildId,
      userId: memberId,
      tracks: [track("Two")],
    });
    now.value += SEARCH_SESSION_TTL_MS;
    expect(store.peek(expiring.id)).toBeNull();
    expect(store.claim(expiring.id, { guildId, userId: memberId })).toBeNull();
  });

  it("stays bounded and renders at most five attributed options", () => {
    const store = sessionStore();
    for (let i = 0; i < 700; i++)
      store.create({
        guildId,
        userId: memberId,
        tracks: Array.from({ length: 8 }, (_, n) => track(`T${i}-${n}`)),
      });
    const session = store.create({
      guildId,
      userId: memberId,
      tracks: Array.from({ length: 8 }, (_, n) => track(`Last-${n}`)),
    });
    expect(session.tracks).toHaveLength(5);
    const row = searchResultComponents(session)[0].toJSON();
    expect(row.components[0]).toMatchObject({ type: 3, min_values: 1 });
    expect(row.components[0].options).toHaveLength(5);
    expect(row.components[0].options![0]).toMatchObject({
      label: "Last-0",
      value: "0",
    });
    expect(row.components[0].options![0].description).toContain("3:00");
    expect(durationLabel(0)).toBe("Live / unknown length");
    expect(durationLabel(3723000)).toBe("1:02:03");
  });
});

describe("search and selection against the queue", () => {
  const services: MusicService[] = [];
  beforeEach(() => {
    vi.clearAllMocks();
    db.setHealth.mockResolvedValue(undefined);
    db.putMusicState.mockResolvedValue(undefined);
    db.getGuild.mockResolvedValue({ config: structuredClone(defaultConfig) });
  });
  afterEach(async () => {
    for (const music of services.splice(0)) {
      music.backend?.players.clear();
      await music.shutdown();
    }
    vi.unstubAllEnvs();
  });

  function service() {
    vi.stubEnv("LAVALINK_URL", "127.0.0.1:1");
    vi.stubEnv("LAVALINK_PASSWORD", "PRIVATE_OFFLINE_BACKEND_PASSWORD");
    const client = Object.assign(new EventEmitter(), {
      user: { id: "120000000000000001" },
      ws: { shards: new Map() },
      isReady: () => false,
    });
    const music = new MusicService(client as unknown as Client);
    services.push(music);
    music.backend!.players.set(guildId, {
      playTrack: async () => {},
      setPaused: async () => {},
      setGlobalVolume: async () => {},
      stopTrack: async () => {},
      seekTo: async () => {},
      on: () => {},
    } as unknown as Player);
    return music;
  }

  function member(overrides: { manage?: boolean } = {}) {
    return {
      id: memberId,
      displayName: "Listener",
      permissions: new PermissionsBitField(
        overrides.manage ? PermissionFlagsBits.ManageGuild : 0n
      ),
      roles: { cache: new Map() },
      guild: {
        id: guildId,
        shardId: 0,
        members: { fetchMe: async () => ({ voice: { channelId: voiceId } }) },
      },
      voice: {
        channel: {
          id: voiceId,
          type: ChannelType.GuildVoice,
          full: false,
          permissionsFor: () =>
            new PermissionsBitField([
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.Speak,
            ]),
        },
      },
    } as unknown as GuildMember;
  }

  function resolved(music: MusicService, titles: string[]) {
    return vi
      .spyOn(
        music as unknown as { resolve: (q: string) => Promise<unknown[]> },
        "resolve"
      )
      .mockResolvedValue(
        titles.map((title) => ({
          encoded: `encoded-${title}`,
          info: {
            title,
            author: "Artist",
            length: 180000,
            uri: "https://soundcloud.com/example/track",
            sourceName: "soundcloud",
          },
        }))
      );
  }

  it("returns bounded candidates without queueing or joining voice", async () => {
    const music = service();
    resolved(music, ["One", "Two", "Three", "Four", "Five", "Six"]);
    const state = music.state(guildId);
    const results = await music.search(member(), "anything", 50);
    expect(results).toHaveLength(5);
    expect(results[0]).toMatchObject({
      title: "One",
      author: "Artist",
      source: "soundcloud",
    });
    expect(state.tracks).toHaveLength(0);
    expect(state.current).toBeNull();
    await expect(music.search(member(), "x".repeat(201))).rejects.toThrow(
      /1 to 200/
    );
    await expect(music.search(member(), "bad\u0000term")).rejects.toThrow(
      /control characters/
    );
  });

  it("refuses a DJ-role-less member when a DJ role is configured", async () => {
    const config = structuredClone(defaultConfig);
    config.music.djRoleId = "120000000000000777";
    db.getGuild.mockResolvedValue({ config });
    const music = service();
    resolved(music, ["One"]);
    await expect(music.search(member(), "anything")).rejects.toThrow(/DJ role/);
  });

  it("queues a picked track once, with its real metadata, and never twice", async () => {
    const music = service();
    resolved(music, ["Chosen"]);
    const picked = (await music.search(member(), "anything"))[0];
    await music.playSelection(member(), [picked]);
    const state = music.state(guildId);
    expect(state.current).toMatchObject({
      title: "Chosen",
      author: "Artist",
      duration: 180000,
      requestedById: memberId,
    });
    await expect(music.playSelection(member(), [picked])).rejects.toThrow(
      /Already in the queue/
    );
    expect(state.tracks).toHaveLength(0);
  });

  it("rejects tampered or empty selections", async () => {
    const music = service();
    await expect(music.playSelection(member(), [])).rejects.toThrow(
      /at least one track/
    );
    await expect(
      music.playSelection(member(), [{ ...track("Bad"), encoded: "" }])
    ).rejects.toThrow(/no longer available/);
    await expect(
      music.playSelection(member(), [
        { ...track("Bad"), encoded: "x".repeat(5000) },
      ])
    ).rejects.toThrow(/no longer available/);
  });
});
