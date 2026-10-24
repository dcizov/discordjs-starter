import { EventEmitter } from "node:events";
import { ChannelType, type Client, type GuildMember } from "discord.js";
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
