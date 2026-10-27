import { EventEmitter } from "node:events";
import {
  ChannelType,
  PermissionFlagsBits,
  PermissionsBitField,
  type Client,
  type GuildMember,
} from "discord.js";
import { LoadType, type Player } from "shoukaku";
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
import type { MusicSearchProvider } from "../packages/core/src/music-sources";
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

  function resolved(
    music: MusicService,
    titles: string[],
    provider: MusicSearchProvider | null = null
  ) {
    return vi
      .spyOn(
        music as unknown as {
          resolve: (
            q: string,
            options?: { provider?: string | null; limit?: number }
          ) => Promise<unknown>;
        },
        "resolve"
      )
      .mockResolvedValue({
        tracks: titles.map((title) => ({
          encoded: `encoded-${title}`,
          info: {
            title,
            author: "Artist",
            length: 180000,
            uri: "https://soundcloud.com/example/track",
            sourceName: "soundcloud",
          },
        })),
        provider,
        source: "soundcloud",
        kind: "search",
      });
  }

  it("returns bounded candidates without queueing or joining voice", async () => {
    const music = service();
    const resolver = resolved(music, [
      "One",
      "Two",
      "Three",
      "Four",
      "Five",
      "Six",
    ]);
    const state = music.state(guildId);
    // An oversized request is clamped to the menu size, and the *resolver* is
    // asked for that many results instead of the caller truncating afterwards.
    const results = await music.search(member(), "anything", { limit: 50 });
    expect(results.tracks).toHaveLength(5);
    expect(resolver.mock.calls[0][1]).toEqual({
      provider: undefined,
      limit: 5,
    });
    expect(results.tracks[0]).toMatchObject({
      title: "One",
      author: "Artist",
      source: "soundcloud",
    });
    expect(results.provider).toBeNull();
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
    const picked = (await music.search(member(), "anything")).tracks[0];
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

  it("forwards an explicit provider to the resolver and reports it back", async () => {
    const music = service();
    const youtube = {
      id: "youtube",
      prefix: "ytsearch",
      manager: "youtube",
      label: "YouTube",
      description: "",
      enableHint: "",
    } as MusicSearchProvider;
    const resolver = resolved(music, ["One", "Two"], youtube);
    const result = await music.search(member(), "anything", {
      limit: 5,
      provider: "youtube",
    });
    expect(resolver.mock.calls[0][1]).toEqual({
      provider: "youtube",
      limit: 5,
    });
    expect(result.provider?.label).toBe("YouTube");
    expect(result.tracks).toHaveLength(2);
  });

  it("queues only the first result for quick play, with the chosen provider", async () => {
    const music = service();
    const resolver = resolved(music, ["First", "Second"], null);
    await music.action(member(), {
      action: "play",
      query: "anything",
      source: "bandcamp",
    });
    // Quick play is limit 1 at the resolver, and the source travels with it.
    expect(resolver.mock.calls[0][1]).toEqual({
      provider: "bandcamp",
      limit: 1,
    });
    const state = music.state(guildId);
    expect(state.current?.title).toBe("First");
    expect(state.tracks).toHaveLength(0);
  });

  it("re-runs authorization for a picked selection instead of trusting the menu", async () => {
    const music = service();
    resolved(music, ["Chosen"]);
    const picked = (await music.search(member(), "anything")).tracks[0];
    // A DJ role is configured after the menu was created: the same member may no
    // longer queue the tracks their (still valid) menu shows.
    const config = structuredClone(defaultConfig);
    config.music.djRoleId = "120000000000000777";
    db.getGuild.mockResolvedValue({ config });
    await expect(music.playSelection(member(), [picked])).rejects.toThrow(
      /DJ role/
    );
    expect(music.state(guildId).current).toBeNull();
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

/**
 * These tests stub only the Lavalink node and its `/v4/info` metadata, so the
 * real `resolveMusicQuery`/`prepareMusicQuery` path runs underneath the service:
 * prefix selection, provider capability checks, the search limit, source-policy
 * validation and error mapping are all exercised, not mocked away.
 */
describe("resolver to service (one backend search, real resolver)", () => {
  const services: MusicService[] = [];
  const sourceManagers = ["soundcloud", "youtube", "bandcamp", "ocremix"];
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
  const lavalinkTrack = (title: string, sourceName = "soundcloud") => ({
    encoded: `encoded-${title}`,
    info: {
      identifier: `id-${title}`,
      isSeekable: true,
      author: "Artist",
      length: 180_000,
      isStream: false,
      position: 0,
      title,
      uri: "https://soundcloud.com/example/track",
      sourceName,
    },
    pluginInfo: {},
  });
  function wired(
    response: unknown,
    managers: string[] = sourceManagers,
    options: { reject?: Error } = {}
  ) {
    vi.stubEnv("LAVALINK_URL", "127.0.0.1:1");
    vi.stubEnv("LAVALINK_PASSWORD", "PRIVATE_OFFLINE_BACKEND_PASSWORD");
    const client = Object.assign(new EventEmitter(), {
      user: { id: "120000000000000001" },
      ws: { shards: new Map() },
      isReady: () => false,
    });
    const music = new MusicService(client as unknown as Client);
    services.push(music);
    const resolve = options.reject
      ? vi.fn().mockRejectedValue(options.reject)
      : vi.fn().mockResolvedValue(response);
    vi.spyOn(music.backend!, "getIdealNode").mockReturnValue({
      rest: { resolve },
    } as never);
    vi.spyOn(
      (
        music as unknown as {
          metadata: { read: (...args: unknown[]) => Promise<unknown> };
        }
      ).metadata,
      "read"
    ).mockResolvedValue({
      version: {
        semver: "4.2.2",
        major: 4,
        minor: 2,
        patch: 2,
        preRelease: null,
        build: null,
      },
      lavaplayer: "4.2.2",
      sourceManagers: managers,
      plugins: [],
    });
    // A player already exists, so quick play needs no real voice/Discord call.
    const player = {
      playTrack: async () => {},
      setPaused: async () => {},
      setGlobalVolume: async () => {},
      stopTrack: async () => {},
      seekTo: async () => {},
      on: () => {},
    } as unknown as Player;
    music.backend!.players.set(guildId, player);
    const join = vi.spyOn(music.backend!, "joinVoiceChannel");
    return { music, resolve, join };
  }
  const member = () =>
    ({
      id: memberId,
      displayName: "Listener",
      permissions: new PermissionsBitField(0n),
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
    }) as unknown as GuildMember;

  it("asks the backend once and returns five candidates from one search", async () => {
    const { music, resolve, join } = wired({
      loadType: LoadType.SEARCH,
      data: Array.from({ length: 7 }, (_, n) => lavalinkTrack(`Track ${n}`)),
    });
    const result = await music.search(member(), "anything", {
      provider: "soundcloud",
      limit: 5,
    });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith("scsearch:anything");
    expect(result.tracks).toHaveLength(5);
    expect(result.tracks[0]).toMatchObject({
      title: "Track 0",
      source: "soundcloud",
      duration: 180_000,
    });
    expect(result.provider?.id).toBe("soundcloud");
    // Read-only: no voice join, no queue change.
    expect(join).not.toHaveBeenCalled();
    expect(music.state(guildId).current).toBeNull();
    expect(music.state(guildId).tracks).toHaveLength(0);
  });

  it("uses the configured default when no provider is chosen", async () => {
    vi.stubEnv("MUSIC_SEARCH_PREFIX", "ytmsearch");
    const { music, resolve } = wired({
      loadType: LoadType.SEARCH,
      data: [lavalinkTrack("Music", "youtube")],
    });
    const result = await music.search(member(), "anything", { limit: 5 });
    // YouTube Music shares the YouTube adapter but keeps its own prefix/catalogue.
    expect(resolve).toHaveBeenCalledWith("ytmsearch:anything");
    expect(result.provider?.id).toBe("youtube-music");
    expect(result.provider?.manager).toBe("youtube");
  });

  it("quick play takes exactly one track from the same search", async () => {
    const { music, resolve } = wired({
      loadType: LoadType.SEARCH,
      data: [
        lavalinkTrack("First", "youtube"),
        lavalinkTrack("Second", "youtube"),
      ],
    });
    await music.action(member(), {
      action: "play",
      query: "anything",
      source: "youtube",
    });
    expect(resolve).toHaveBeenCalledWith("ytsearch:anything");
    const state = music.state(guildId);
    expect(state.current?.title).toBe("First");
    expect(state.tracks).toHaveLength(0);
  });

  it("reports an empty search instead of queueing nothing", async () => {
    const { music } = wired({ loadType: LoadType.EMPTY, data: {} });
    await expect(
      music.search(member(), "anything", { provider: "bandcamp" })
    ).rejects.toThrow(/Bandcamp returned no playable tracks/);
  });

  it("keeps the backend failure visible and starts no playback", async () => {
    const { music, join } = wired(null, sourceManagers, {
      reject: new Error("ECONNREFUSED 127.0.0.1:2333"),
    });
    await expect(
      music.search(member(), "anything", { provider: "soundcloud" })
    ).rejects.toThrow(/music backend request failed during track lookup/);
    await expect(
      music.action(member(), {
        action: "play",
        query: "anything",
        source: "soundcloud",
      })
    ).rejects.toThrow(/music backend request failed during track lookup/);
    expect(join).not.toHaveBeenCalled();
    expect(music.state(guildId).current).toBeNull();
  });

  it("refuses candidates from a source outside the approved policy", async () => {
    const { music } = wired({
      loadType: LoadType.SEARCH,
      data: [lavalinkTrack("Elsewhere", "spotify")],
    });
    await expect(
      music.search(member(), "anything", { provider: "soundcloud" })
    ).rejects.toThrow(/outside the approved music-source policy/);
    expect(music.state(guildId).current).toBeNull();
  });

  it("refuses a provider whose adapter is not registered, without a lookup", async () => {
    const { music, resolve } = wired(
      { loadType: LoadType.SEARCH, data: [lavalinkTrack("Track")] },
      ["soundcloud"]
    );
    await expect(
      music.search(member(), "anything", { provider: "bandcamp" })
    ).rejects.toThrow(/Bandcamp search is not enabled on this Lavalink node/);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("rejects an unknown provider before any backend call", async () => {
    const { music, resolve } = wired({
      loadType: LoadType.SEARCH,
      data: [lavalinkTrack("Track")],
    });
    await expect(
      music.search(member(), "anything", { provider: "scsearch:raw" })
    ).rejects.toThrow(/Unknown search provider/);
    expect(resolve).not.toHaveBeenCalled();
  });
});
