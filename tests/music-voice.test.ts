import { EventEmitter } from "node:events";
import {
  GatewayIntentBits,
  IntentsBitField,
  Status,
  type Client,
} from "discord.js";
import { Shoukaku, type Node } from "shoukaku";
import { describe, expect, it, vi } from "vitest";
import {
  joinMusicVoice,
  MusicDiscordConnector,
} from "../apps/bot/src/music-voice";
const guildId = "120000000000000001",
  botId = "120000000000000012",
  channelId = "120000000000000111";
function setup(
  mode:
    "state-first" | "server-first" | "no-server" | "no-events" = "state-first",
  initiallyJoined = false
) {
  const client = Object.assign(new EventEmitter(), {
    user: { id: botId },
    ws: {
      shards: new Map<
        number,
        { status: Status; send: ReturnType<typeof vi.fn> }
      >(),
    },
    isReady: () => true,
    options: {
      intents: new IntentsBitField([GatewayIntentBits.GuildVoiceStates]),
    },
  });
  let joined = initiallyJoined;
  const state = (id: string | null) =>
    client.emit("raw", {
      t: "VOICE_STATE_UPDATE",
      d: {
        guild_id: guildId,
        user_id: botId,
        channel_id: id,
        session_id: "PRIVATE_VOICE_SESSION",
        self_deaf: true,
        self_mute: false,
      },
    });
  const server = () =>
    client.emit("raw", {
      t: "VOICE_SERVER_UPDATE",
      d: {
        guild_id: guildId,
        endpoint: "private-voice.discord.example",
        token: "PRIVATE_VOICE_TOKEN",
      },
    });
  const send = vi.fn((payload: any) => {
    queueMicrotask(() => {
      if (payload.d.channel_id === null) {
        joined = false;
        state(null);
        return;
      }
      if (mode === "no-events") return;
      const wasJoined = joined;
      joined = true;
      if (mode === "server-first" && !wasJoined) server();
      state(channelId);
      if (mode === "state-first" && !wasJoined) server();
    });
  });
  client.ws.shards.set(0, { send, status: Status.Ready });
  const connector = new MusicDiscordConnector(client as unknown as Client);
  const backend = new Shoukaku(connector, [], {
    voiceConnectionTimeout: 0.025,
  });
  client.emit("clientReady");
  const node = {
    manager: backend,
    name: "test",
    rest: {
      updatePlayer: vi.fn(async () => ({})),
      destroyPlayer: vi.fn(async () => undefined),
    },
  } as unknown as Node;
  vi.spyOn(backend, "getIdealNode").mockReturnValue(node);
  return { client, connector, backend, send, node, state };
}
const options = { guildId, channelId, shardId: 0, currentChannelId: null };

describe("real Shoukaku handshake with an offline gateway transport fixture", () => {
  it.each(["state-first", "server-first"] as const)(
    "creates a player with either Discord event order (%s)",
    async (order) => {
      const t = setup(order);
      const player = await joinMusicVoice(t.backend, t.connector, options);
      expect(player.guildId).toBe(guildId);
      expect(t.node.rest.updatePlayer).toHaveBeenCalledWith(
        expect.objectContaining({
          guildId,
          playerOptions: {
            voice: expect.objectContaining({
              channelId,
              sessionId: "PRIVATE_VOICE_SESSION",
              token: "PRIVATE_VOICE_TOKEN",
            }),
          },
        })
      );
      await t.backend.leaveVoiceChannel(guildId);
    }
  );
  it("reproduces a same-channel no-op timeout, then recovers by leaving the orphan first", async () => {
    const t = setup("state-first", true);
    // This is the upstream failure mode: no fresh VOICE_SERVER_UPDATE on a no-op join.
    await expect(
      t.backend.joinVoiceChannel({ guildId, channelId, shardId: 0 })
    ).rejects.toThrow("not established");
    expect(t.backend.connections.has(guildId)).toBe(false);
    expect(t.send.mock.calls.at(-1)![0].d.channel_id).toBe(channelId); // upstream did not leave
    const player = await joinMusicVoice(t.backend, t.connector, {
      ...options,
      currentChannelId: channelId,
    });
    expect(player.guildId).toBe(guildId);
    expect(t.send.mock.calls.map(([packet]) => packet.d.channel_id)).toEqual([
      channelId,
      null,
      channelId,
    ]);
    await t.backend.leaveVoiceChannel(guildId);
  });
  it("cleans up a failed join before player creation and reports missing events without secrets", async () => {
    const t = setup("no-server");
    const error = await joinMusicVoice(t.backend, t.connector, options).catch(
      (error: Error) => error
    );
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain("own voice state received: true");
    expect(message).toContain("voice server received: false");
    for (const secret of [
      "PRIVATE_VOICE_SESSION",
      "PRIVATE_VOICE_TOKEN",
      "private-voice.discord.example",
    ])
      expect(message).not.toContain(secret);
    expect(t.send.mock.calls.at(-1)![0].d.channel_id).toBeNull();
    expect(t.backend.players.size).toBe(0);
    expect(t.node.rest.updatePlayer).not.toHaveBeenCalled();
  });
  it("distinguishes no gateway acknowledgements from a provider or UDP failure", async () => {
    const t = setup("no-events");
    await expect(
      joinMusicVoice(t.backend, t.connector, options)
    ).rejects.toThrow(
      "own voice state received: false; voice server received: false"
    );
    expect(t.node.rest.updatePlayer).not.toHaveBeenCalled();
  });
  it("fails explicitly for an absent gateway shard instead of silently dropping the join", async () => {
    const t = setup();
    t.client.ws.shards.clear();
    await expect(
      joinMusicVoice(t.backend, t.connector, options)
    ).rejects.toThrow("gateway shard 0 is unavailable");
    expect(t.node.rest.updatePlayer).not.toHaveBeenCalled();
  });
  it("does not silently enqueue a join on a reconnecting shard or later replay it", async () => {
    const t = setup();
    t.client.ws.shards.get(0)!.status = Status.Connecting;
    const error = await joinMusicVoice(t.backend, t.connector, options).catch(
      (error: Error) => error
    );
    expect(String(error)).toContain("is not ready");
    expect(String(error)).toContain("target shard ready: false");
    expect(String(error)).toContain("Join sent: false");
    expect(t.send).not.toHaveBeenCalled();
    t.client.ws.shards.get(0)!.status = Status.Ready;
    expect(t.send).not.toHaveBeenCalled();
    expect(t.backend.connections.size).toBe(0);
  });
  it("identifies a running client without the normal voice intent before joining", async () => {
    const t = setup();
    t.client.options.intents.remove(GatewayIntentBits.GuildVoiceStates);
    await expect(
      joinMusicVoice(t.backend, t.connector, options)
    ).rejects.toThrow("GuildVoiceStates intent enabled: false");
    expect(
      t.send.mock.calls.every(([packet]) => packet.d.channel_id === null)
    ).toBe(true); // cleanup only
    expect(t.node.rest.updatePlayer).not.toHaveBeenCalled();
  });

  it("does not mistake another member's voice event for the bot's leave acknowledgement", async () => {
    const t = setup();
    t.client.ws.shards.set(0, { send: vi.fn(), status: Status.Ready });
    const pending = t.connector.clearStaleVoice(guildId, 0, 10);
    t.client.emit("raw", {
      t: "VOICE_STATE_UPDATE",
      d: { guild_id: guildId, user_id: "someone-else", channel_id: null },
    });
    await expect(pending).rejects.toThrow("did not acknowledge");
    expect(t.client.listenerCount("raw")).toBe(1); // only the connector remains
  });
});
