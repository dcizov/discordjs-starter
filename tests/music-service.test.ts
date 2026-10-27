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
const services: MusicService[] = [];
function service(configured = true) {
  vi.stubEnv("LAVALINK_URL", configured ? "127.0.0.1:1" : "");
  vi.stubEnv(
    "LAVALINK_PASSWORD",
    configured ? "PRIVATE_OFFLINE_BACKEND_PASSWORD" : ""
  );
  const client = Object.assign(new EventEmitter(), {
    user: { id: "120000000000000001" },
    ws: { shards: new Map() },
    isReady: () => false,
    // Empty by default: an uncached guild means "nobody is listening", which is
    // what the empty-channel tests below override explicitly.
    guilds: { cache: new Map() },
  });
  // Never emit clientReady: these state/health tests must make no network calls.
  const music = new MusicService(client as unknown as Client);
  services.push(music);
  return music;
}
beforeEach(() => {
  vi.clearAllMocks();
  db.setHealth.mockResolvedValue(undefined);
  db.putMusicState.mockResolvedValue(undefined);
  db.getGuild.mockResolvedValue({ config: defaultConfig });
});
afterEach(async () => {
  for (const music of services.splice(0)) {
    music.backend?.players.clear();
    await music.shutdown();
  }
  vi.unstubAllEnvs();
});

describe("music configuration, availability and session truthfulness", () => {
  it("labels missing configuration as disabled rather than claiming an active retry", async () => {
    const music = service(false);
    expect(music.backend).toBeNull();
    await music.heartbeat();
    expect(db.setHealth).toHaveBeenLastCalledWith(
      "Music backend",
      "offline",
      0,
      "Music disabled: configure LAVALINK_URL and LAVALINK_PASSWORD"
    );
  });
  it("distinguishes a configured/disconnected backend from missing credentials", async () => {
    const music = service();
    await music.heartbeat();
    expect(db.setHealth).toHaveBeenLastCalledWith(
      "Music backend",
      "degraded",
      0,
      "Lavalink configured but disconnected; retrying automatically"
    );
    const voice = {
      id: "120000000000000010",
      type: ChannelType.GuildVoice,
      full: false,
      permissionsFor: () => ({ has: () => true }),
    };
    const member = {
      guild: {
        id: "120000000000000002",
        members: { fetchMe: async () => ({ voice: { channelId: null } }) },
      },
      voice: { channel: voice },
    } as unknown as GuildMember;
    await expect(
      music.action(member, { action: "play", query: "test" })
    ).rejects.toThrow("Lavalink is configured but not connected");
    await expect(
      music.action(member, { action: "play", query: "test" })
    ).rejects.toThrow("not a Discord voice-permission error");
    expect(db.putMusicState).not.toHaveBeenCalled();
  });
  it.each([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.Connect,
    PermissionFlagsBits.Speak,
  ])(
    "rejects missing voice permission %s before source lookup or join, with refreshed bot roles",
    async (denied) => {
      const music = service();
      const required = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
      ];
      const permissions = new PermissionsBitField(
        required.filter((permission) => permission !== denied)
      );
      const fetchMe = vi.fn(async () => ({ voice: { channelId: null } }));
      const member = {
        guild: { id: "120000000000000002", members: { fetchMe } },
        voice: {
          channel: {
            id: "120000000000000010",
            type: ChannelType.GuildVoice,
            full: false,
            permissionsFor: () => permissions,
          },
        },
      } as unknown as GuildMember;
      const lookup = vi.spyOn(music.backend!, "getIdealNode");
      const join = vi.spyOn(music.backend!, "joinVoiceChannel");
      await expect(
        music.action(member, { action: "play", query: "test" })
      ).rejects.toThrow("View Channel, Connect and Speak");
      expect(fetchMe).toHaveBeenCalledWith({ force: true });
      expect(lookup).not.toHaveBeenCalled();
      expect(join).not.toHaveBeenCalled();
    }
  );

  it("clears orphan players/queue state after a new server session without replaying a request", async () => {
    const music = service(),
      backend = music.backend!;
    const id = "120000000000000002";
    const player = { node: { name: "main" } } as unknown as Player;
    backend.players.set(id, player);
    const leave = vi
      .spyOn(backend, "leaveVoiceChannel")
      .mockImplementation(async () => {
        backend.players.delete(id);
      });
    const join = vi.spyOn(backend, "joinVoiceChannel");
    music.state(id).position = 1000;
    backend.emit("ready", "main", false, false);
    await vi.waitFor(() =>
      expect(db.putMusicState).toHaveBeenCalledWith(
        id,
        expect.objectContaining({ current: null, tracks: [], position: 0 })
      )
    );
    expect(leave).toHaveBeenCalledWith(id);
    expect(join).not.toHaveBeenCalled();
    expect(backend.players.size).toBe(0);
  });
  it("does not let an old queued voice-close callback erase a replacement player's session", async () => {
    const music = service(),
      id = "120000000000000002";
    const old = Object.assign(new EventEmitter(), {
      guildId: id,
    }) as unknown as Player;
    const replacement = Object.assign(new EventEmitter(), {
      guildId: id,
    }) as unknown as Player;
    const internal = music as unknown as {
      wire(player: Player): void;
      locked(id: string, fn: () => Promise<void>): Promise<void>;
    };
    let release!: () => void;
    const held = internal.locked(
      id,
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        })
    );
    await new Promise<void>((resolve) => setImmediate(resolve));
    music.backend!.players.set(id, old);
    internal.wire(old);
    (old as unknown as EventEmitter).emit("closed", {});
    music.backend!.players.set(id, replacement);
    music.state(id).position = 1234;
    release();
    await held;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(music.state(id).position).toBe(1234);
    expect(db.putMusicState).not.toHaveBeenCalled();
  });
  it("ignores track end and position updates from an obsolete player", async () => {
    const music = service(),
      id = "120000000000000002";
    const old = Object.assign(new EventEmitter(), {
      guildId: id,
    }) as unknown as Player;
    const replacement = Object.assign(new EventEmitter(), {
      guildId: id,
    }) as unknown as Player;
    (music as unknown as { wire(player: Player): void }).wire(old);
    music.backend!.players.set(id, replacement);
    music.state(id).position = 4321;
    (old as unknown as EventEmitter).emit("update", { state: { position: 0 } });
    (old as unknown as EventEmitter).emit("end", { reason: "finished" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(music.state(id).position).toBe(4321);
    expect(db.putMusicState).not.toHaveBeenCalled();
  });
  it("detaches connector listeners even if shutdown snapshot persistence fails", async () => {
    const music = service(),
      id = "120000000000000002";
    const client = (music as unknown as { client: EventEmitter }).client;
    music.backend!.players.set(id, {} as Player);
    vi.spyOn(music.backend!, "leaveVoiceChannel").mockImplementationOnce(
      async () => {
        music.backend!.players.delete(id);
      }
    );
    db.putMusicState.mockRejectedValueOnce(
      new Error("Test database unavailable")
    );
    await expect(music.shutdown()).resolves.toBeUndefined();
    expect(client.listenerCount("raw")).toBe(0);
  });
  it("preserves an actually resumed Lavalink session rather than erasing its queue", async () => {
    const music = service(),
      backend = music.backend!;
    const id = "120000000000000002";
    backend.players.set(id, { node: { name: "main" } } as unknown as Player);
    music.state(id).position = 1000;
    const leave = vi.spyOn(backend, "leaveVoiceChannel");
    backend.emit("ready", "main", true, false);
    await Promise.resolve();
    expect(leave).not.toHaveBeenCalled();
    expect(db.putMusicState).not.toHaveBeenCalled();
    expect(music.state(id).position).toBe(1000);
  });
});

it("serializes same-member admissions and rejects oversized playlists before queue changes/voice work", async () => {
  const music = service(),
    guildId = "120000000000000002",
    memberId = "120000000000000099",
    voiceId = "120000000000000208";
  const config = structuredClone(defaultConfig);
  config.music.maxPerMember = 1;
  db.getGuild.mockResolvedValue({ config });
  const member = {
    id: memberId,
    displayName: "Listener",
    permissions: new PermissionsBitField(0n),
    roles: { cache: new Map() },
    guild: {
      id: guildId,
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
  const state = music.state(guildId);
  state.current = {
    id: "now",
    title: "Current",
    author: "Artist",
    duration: 1000,
    uri: "",
    requestedBy: "Listener",
    requestedById: memberId,
  };
  music.backend!.players.set(guildId, {} as Player);
  const resolve = vi
    .spyOn(
      music as unknown as { resolve: (q: string) => Promise<unknown> },
      "resolve"
    )
    // The resolver returns tracks *plus* the provider that answered; the mocked
    // shape has to match, otherwise the service's own mapping is never exercised.
    .mockResolvedValue({
      tracks: [
        {
          encoded: "fixture",
          info: {
            title: "Clean recording",
            author: "Artist",
            length: 1000,
            uri: "",
          },
        },
      ],
      provider: null,
      source: "soundcloud",
      kind: "search",
    });
  const results = await Promise.allSettled([
    music.action(member, { action: "play", query: "first" }),
    music.action(member, { action: "play", query: "second" }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(state.tracks).toHaveLength(1);
  expect(state.tracks[0].requestedById).toBe(memberId);
  resolve.mockResolvedValue({
    tracks: Array.from({ length: 3 }, () => ({
      encoded: "fixture",
      info: { title: "Playlist", author: "Artist", length: 1000, uri: "" },
    })),
    provider: null,
    source: "soundcloud",
    kind: "search",
  });
  const before = structuredClone(state.tracks);
  await expect(
    music.action(member, { action: "play", query: "playlist" })
  ).rejects.toThrow(/entire request/);
  expect(state.tracks).toEqual(before);
});

describe("seek on a finite track", () => {
  const guildId = "120000000000000004",
    memberId = "120000000000000099",
    voiceId = "120000000000000209";
  function member() {
    return {
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
    } as unknown as GuildMember;
  }
  function player() {
    return {
      playTrack: vi.fn(async () => {}),
      setGlobalVolume: vi.fn(async () => {}),
      setPaused: vi.fn(async () => {}),
      stopTrack: vi.fn(async () => {}),
      seekTo: vi.fn(async () => {}),
    };
  }
  function current(duration: number) {
    return {
      id: "now",
      title: "Current",
      author: "Artist",
      duration,
      uri: "",
      encoded: "encoded-current",
      requestedBy: "Listener",
      requestedById: memberId,
    };
  }

  it("asks Lavalink to seek and records the reported position", async () => {
    const music = service();
    const p = player();
    music.backend!.players.set(guildId, p as unknown as Player);
    const state = music.state(guildId);
    state.current = current(180000);
    await music.action(member(), { action: "seek", position: 30 });
    expect(p.seekTo).toHaveBeenCalledWith(30000);
    expect(state.position).toBe(30000);
    expect(db.putMusicState).toHaveBeenCalled();
  });

  it("clamps to just before the end and rejects non-finite or invalid input", async () => {
    const music = service();
    const p = player();
    music.backend!.players.set(guildId, p as unknown as Player);
    const state = music.state(guildId);
    state.current = current(60000);
    await music.action(member(), { action: "seek", position: 600 });
    expect(p.seekTo).toHaveBeenCalledWith(59000);
    for (const position of [-1, 1.5, Number.NaN])
      await expect(
        music.action(member(), { action: "seek", position })
      ).rejects.toThrow(/seek position in seconds/);
    state.current = current(0);
    await expect(
      music.action(member(), { action: "seek", position: 5 })
    ).rejects.toThrow(/no known duration/);
    expect(p.seekTo).toHaveBeenCalledTimes(1);
  });
});

describe("a deleted DJ role", () => {
  const guildId = "120000000000000005",
    memberId = "120000000000000099",
    voiceId = "120000000000000210";
  function member(manage: boolean) {
    return {
      id: memberId,
      displayName: "Listener",
      permissions: new PermissionsBitField(
        manage ? PermissionFlagsBits.ManageGuild : 0n
      ),
      roles: { cache: new Map() },
      guild: {
        id: guildId,
        shardId: 0,
        roles: { cache: new Map() },
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
  beforeEach(() => {
    const config = structuredClone(defaultConfig);
    config.music.djRoleId = "120000000000000777";
    db.getGuild.mockResolvedValue({ config });
  });

  it("does not silently open controls to everyone, and lets managers repair it", async () => {
    const music = service();
    music.backend!.players.set(guildId, {
      playTrack: vi.fn(),
      setGlobalVolume: vi.fn(),
      setPaused: vi.fn(),
      stopTrack: vi.fn(),
      seekTo: vi.fn(),
    } as unknown as Player);
    const state = music.state(guildId);
    state.current = {
      id: "now",
      title: "Current",
      author: "Artist",
      duration: 1000,
      uri: "",
      encoded: "encoded",
      requestedBy: "Listener",
      requestedById: memberId,
    };
    await expect(
      music.action(member(false), { action: "pause" })
    ).rejects.toThrow(/no longer exists/);
    await music.action(member(true), { action: "pause" });
    expect(state.paused).toBe(true);
  });
});

describe("idle voice disconnect", () => {
  type Internals = {
    wire(player: Player): void;
    idle: {
      reason(id: string): string | undefined;
      schedule(id: string, reason: string, seconds: number): void;
      cancel(id: string): void;
    };
    cancelQueueIdle(id: string): boolean;
    leaveWhenIdle(id: string, reason: string): Promise<void>;
  };
  /**
   * Put listeners (and/or other bots) in the channel Orbit sits in. The service
   * reads this instead of a member list fetch, so tests can be explicit about who
   * is "there".
   */
  function listeners(
    music: MusicService,
    id: string,
    humans: number,
    bots = 0
  ) {
    const members = new Map<string, { user: { bot: boolean } }>();
    for (let n = 0; n < humans; n++)
      members.set(`human-${n}`, { user: { bot: false } });
    for (let n = 0; n < bots; n++)
      members.set(`bot-${n}`, { user: { bot: true } });
    (
      music as unknown as {
        client: { guilds: { cache: Map<string, unknown> } };
      }
    ).client.guilds.cache.set(id, {
      members: { me: { voice: { channel: { id: "voice", members } } } },
    });
  }
  function wired(queueSize = 0) {
    const music = service(),
      id = "120000000000000002";
    const player = Object.assign(new EventEmitter(), {
      guildId: id,
    }) as unknown as Player;
    music.backend!.players.set(id, player);
    const internals = music as unknown as Internals;
    internals.wire(player);
    const state = music.state(id);
    state.current = {
      id: "track-1",
      title: "A public track",
      author: "Artist",
      duration: 200_000,
      uri: "",
      requestedBy: "Listener",
      source: "youtube",
    };
    for (let n = 0; n < queueSize; n++)
      state.tracks.push({
        id: `track-${n + 2}`,
        title: `Queued ${n + 1}`,
        author: "Artist",
        duration: 180_000,
        uri: "",
        requestedBy: "Listener",
      });
    const leave = vi
      .spyOn(music.backend!, "leaveVoiceChannel")
      .mockResolvedValue(undefined);
    return { music, id, player, internals, leave, state };
  }
  it("waits after the last track instead of dropping out of voice", async () => {
    const { music, id, player, internals, leave, state } = wired();
    (player as unknown as EventEmitter).emit("end", { reason: "finished" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(leave).not.toHaveBeenCalled();
    expect(internals.idle.reason(id)).toBe("queue-finished");
    expect(state.current).toBeNull();
    expect(db.putMusicState).toHaveBeenCalled();
    internals.idle.cancel(id);
    await music.shutdown();
  });
  it("uses the same wait for a track that failed to load", async () => {
    const { music, id, player, internals, leave } = wired();
    (player as unknown as EventEmitter).emit("end", { reason: "loadFailed" });
    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(leave).not.toHaveBeenCalled();
    expect(internals.idle.reason(id)).toBe("track-failed");
    internals.idle.cancel(id);
    await music.shutdown();
  });
  it("re-checks the queue before the timer disconnects", async () => {
    const { music, id, internals, leave, state } = wired();
    internals.idle.schedule(id, "queue-finished", 60);
    state.tracks.push({
      id: "track-late",
      title: "Queued while idle",
      author: "Artist",
      duration: 100_000,
      uri: "",
      requestedBy: "Listener",
      encoded: "encoded-track",
    });
    await internals.leaveWhenIdle(id, "queue-finished");
    expect(leave).not.toHaveBeenCalled();
    internals.idle.cancel(id);
    await music.shutdown();
  });
  it("leaves once the queue is really empty, and clears the snapshot", async () => {
    const { music, id, internals, leave, state } = wired();
    state.current = null;
    await internals.leaveWhenIdle(id, "queue-finished");
    expect(leave).toHaveBeenCalledWith(id);
    expect(music.state(id).current).toBeNull();
    expect(db.putMusicState).toHaveBeenCalled();
    await music.shutdown();
  });
  it("leaves an empty channel even while a track is still playing", async () => {
    // Audio is still running, but nobody is listening: the empty-channel policy
    // is not blocked by playback, unlike the queue-idle policy.
    const { music, id, internals, leave, state } = wired(1);
    expect(state.current).not.toBeNull();
    listeners(music, id, 0);
    await internals.leaveWhenIdle(id, "alone");
    expect(leave).toHaveBeenCalledWith(id);
    await music.shutdown();
  });

  it("keeps playing when a listener is back in the channel", async () => {
    const { music, id, internals, leave } = wired();
    listeners(music, id, 1);
    await internals.leaveWhenIdle(id, "alone");
    expect(leave).not.toHaveBeenCalled();
    await music.shutdown();
  });

  it("counts only humans, so bot-only listeners still trigger the empty-channel leave", async () => {
    const { music, id, internals, leave } = wired();
    listeners(music, id, 0, 3);
    await internals.leaveWhenIdle(id, "alone");
    expect(leave).toHaveBeenCalledWith(id);
    await music.shutdown();
  });

  it("does not cancel an empty-channel timer just because a track started", async () => {
    const { music, id, internals, state } = wired();
    const player = music.backend!.players.get(id)!;
    (player as unknown as { playTrack: () => Promise<void> }).playTrack = vi.fn(
      async () => {}
    );
    state.tracks.push({
      id: "queued",
      title: "Queued while the channel emptied",
      author: "Artist",
      duration: 60_000,
      uri: "",
      requestedBy: "Listener",
      encoded: "encoded-queued",
    });
    listeners(music, id, 0);
    internals.idle.schedule(id, "alone", 15);
    // `next()` runs when the current track ends and a queued one starts.
    await (
      internals as unknown as { next(id: string, p: Player): Promise<void> }
    ).next(id, player);
    expect(state.current?.title).toContain("Queued");
    // Starting a track cancels a *queue* leave; the empty-channel leave stands.
    expect(internals.idle.reason(id)).toBe("alone");
    internals.idle.cancel(id);
    await music.shutdown();
  });

  it("drops the empty-channel timer once a human is back, even for queue activity", async () => {
    const { music, id, internals } = wired();
    internals.idle.schedule(id, "alone", 15);
    listeners(music, id, 0);
    // Queue activity in an empty channel must not disable the cleanup...
    expect(internals.cancelQueueIdle(id)).toBe(false);
    expect(internals.idle.reason(id)).toBe("alone");
    // ...but a returning listener does.
    listeners(music, id, 1);
    expect(internals.cancelQueueIdle(id)).toBe(true);
    expect(internals.idle.reason(id)).toBeUndefined();
    await music.shutdown();
  });

  it("cancels a pending queue-idle leave for ordinary queue activity", async () => {
    const { music, id, internals } = wired();
    internals.idle.schedule(id, "queue-finished", 60);
    expect(internals.cancelQueueIdle(id)).toBe(true);
    expect(internals.idle.reason(id)).toBeUndefined();
    await music.shutdown();
  });

  it("lets the newest reason win when an empty channel also finishes its queue", async () => {
    const { music, id, internals, leave } = wired();
    listeners(music, id, 0);
    internals.idle.schedule(id, "alone", 15);
    internals.idle.schedule(id, "queue-finished", 60);
    expect(internals.idle.reason(id)).toBe("queue-finished");
    await internals.leaveWhenIdle(id, "queue-finished");
    // A track is still playing, so the queue reason cancels even though the
    // channel is empty; the next empty-channel event schedules its own leave.
    expect(leave).not.toHaveBeenCalled();
    await internals.leaveWhenIdle(id, "alone");
    expect(leave).toHaveBeenCalledWith(id);
    await music.shutdown();
  });

  it("drops the pending leave and the player when Orbit leaves the guild", async () => {
    const { music, id, internals, leave } = wired();
    internals.idle.schedule(id, "alone", 15);
    await music.guildRemoved(id);
    expect(internals.idle.reason(id)).toBeUndefined();
    expect(leave).toHaveBeenCalledWith(id);
    await music.shutdown();
  });

  it("clears every pending timer on shutdown", async () => {
    const { music, id, internals } = wired();
    internals.idle.schedule(id, "queue-finished", 60);
    await music.shutdown();
    expect(internals.idle.reason(id)).toBeUndefined();
  });
});
