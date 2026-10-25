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
import { MusicService } from "../apps/bot/src/music";
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
      music as unknown as { resolve: (q: string) => Promise<unknown[]> },
      "resolve"
    )
    .mockResolvedValue([
      {
        encoded: "fixture",
        info: {
          title: "Clean recording",
          author: "Artist",
          length: 1000,
          uri: "",
        },
      },
    ]);
  const results = await Promise.allSettled([
    music.action(member, { action: "play", query: "first" }),
    music.action(member, { action: "play", query: "second" }),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(state.tracks).toHaveLength(1);
  expect(state.tracks[0].requestedById).toBe(memberId);
  resolve.mockResolvedValue(
    Array.from({ length: 3 }, () => ({
      encoded: "fixture",
      info: { title: "Playlist", author: "Artist", length: 1000, uri: "" },
    }))
  );
  const before = structuredClone(state.tracks);
  await expect(
    music.action(member, { action: "play", query: "playlist" })
  ).rejects.toThrow(/entire request/);
  expect(state.tracks).toEqual(before);
});
